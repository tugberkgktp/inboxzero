// Background worker — a SEPARATE process/container from the API.
// It consumes item jobs off the BullMQ queue and processes each with AI.
//
// Key guarantees:
//  - Idempotent: a status guard means re-processing a `done` item is a no-op,
//    and results are keyed by item id (overwrite, never duplicate rows).
//  - Retries: throwing lets BullMQ retry with exponential backoff (configured
//    in queue.ts). Only the FINAL failure marks the item `failed`.
//  - Failure isolation: each item is its own job, so one bad item never blocks
//    or fails the rest of the batch.
//  - Rate limiting: a concurrency cap plus a queue-wide limiter keep us under
//    the AI provider's request limit; genuine 429s pause the worker and retry
//    without consuming an attempt.
import { Worker, Job } from "bullmq";
import { ItemStatus } from "@prisma/client";
import { ITEM_QUEUE, connection, ItemJobData } from "./queue";
import { prisma } from "./db";
import { classify, ProviderRateLimitError } from "./ai";
import { recomputeJobStatus } from "./jobs/service";
import { env } from "./env";

async function processItem(job: Job<ItemJobData>) {
  const { itemId } = job.data;

  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) return; // deleted; nothing to do

  // Idempotency guard: if already finished, do nothing.
  if (item.status === ItemStatus.done) return;

  // Claim the item. The attempt counter is incremented only once we actually
  // run the model (below), so a rate-limit deferral never inflates it.
  await prisma.item.update({
    where: { id: itemId },
    data: { status: ItemStatus.processing },
  });

  let result;
  try {
    result = await classify(item.inputText);
  } catch (err) {
    if (err instanceof ProviderRateLimitError) {
      // Pause the whole worker, then signal BullMQ to re-run this job later
      // without counting it as a failed attempt.
      await worker.rateLimit(err.retryAfterMs);
      throw Worker.RateLimitError();
    }
    // Genuine failure: count the attempt and let BullMQ apply retry/backoff.
    await prisma.item.update({
      where: { id: itemId },
      data: { attempts: { increment: 1 } },
    });
    throw err;
  }

  // Write results keyed by item id. Re-running overwrites cleanly.
  await prisma.item.update({
    where: { id: itemId },
    data: {
      status: ItemStatus.done,
      attempts: { increment: 1 },
      category: result.category,
      priority: result.priority,
      sentiment: result.sentiment,
      summary: result.summary,
      suggestedReply: result.suggestedReply,
      error: null,
    },
  });

  await recomputeJobStatus(item.jobId);
}

const worker = new Worker<ItemJobData>(ITEM_QUEUE, processItem, {
  connection,
  concurrency: env.WORKER_CONCURRENCY,
  limiter: { max: env.AI_RATE_MAX, duration: env.AI_RATE_DURATION_MS },
});

// BullMQ emits "failed" on EVERY failed attempt. We only treat it as terminal
// once retries are exhausted; until then the item stays `processing` and BullMQ
// re-runs it after the backoff delay.
worker.on("failed", async (job, err) => {
  if (!job) return;
  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade < maxAttempts) {
    console.log(
      `↻ item ${job.data.itemId} attempt ${job.attemptsMade}/${maxAttempts} failed, will retry`,
    );
    return; // not terminal yet
  }

  const { itemId } = job.data;
  try {
    await prisma.item.update({
      where: { id: itemId },
      data: { status: ItemStatus.failed, error: err.message.slice(0, 1000) },
    });
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      select: { jobId: true },
    });
    if (item) await recomputeJobStatus(item.jobId);
  } catch (e) {
    console.error("Failed to record item failure:", e);
  }
});

worker.on("completed", (job) => {
  console.log(`✔ item ${job.data.itemId} done`);
});

worker.on("ready", () => {
  console.log(
    `Worker ready (queue=${ITEM_QUEUE}, concurrency=${env.WORKER_CONCURRENCY})`,
  );
});

const shutdown = async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
