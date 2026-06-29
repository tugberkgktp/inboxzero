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
//  - Rate limiting: concurrency cap (WORKER_CONCURRENCY) bounds parallel AI calls.
import { Worker, Job } from "bullmq";
import { ItemStatus } from "@prisma/client";
import { ITEM_QUEUE, connection, ItemJobData } from "./queue";
import { prisma } from "./db";
import { classify } from "./ai";
import { recomputeJobStatus } from "./jobs/service";
import { env } from "./env";

async function processItem(job: Job<ItemJobData>) {
  const { itemId } = job.data;

  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) return; // deleted; nothing to do

  // Idempotency guard: if already finished, do nothing.
  if (item.status === ItemStatus.done) return;

  // Claim the item: mark processing and count this attempt.
  await prisma.item.update({
    where: { id: itemId },
    data: { status: ItemStatus.processing, attempts: { increment: 1 } },
  });

  // May throw -> BullMQ catches and retries (until attempts exhausted).
  const result = await classify(item.inputText);

  // Write results keyed by item id. Re-running overwrites cleanly.
  await prisma.item.update({
    where: { id: itemId },
    data: {
      status: ItemStatus.done,
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
