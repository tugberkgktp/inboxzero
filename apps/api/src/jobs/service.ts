// Business logic for jobs/items, shared between the API routes and the worker.
import { ItemStatus, JobStatus } from "@prisma/client";
import { prisma } from "../db";
import { enqueueItem } from "../queue";
import { badRequest, notFound } from "../lib/errors";
import { env } from "../env";

/**
 * Create a job + its items in ONE transaction, then enqueue each item.
 * Returns immediately with the job id; no AI work happens here.
 */
export async function createJob(userId: string, rawItems: string[]) {
  const items = rawItems.map((t) => t.trim()).filter((t) => t.length > 0);

  if (items.length === 0) {
    throw badRequest("Batch must contain at least one non-empty item.");
  }
  if (items.length > env.MAX_BATCH_ITEMS) {
    throw badRequest(`Batch exceeds the limit of ${env.MAX_BATCH_ITEMS} items.`);
  }

  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.job.create({
      data: {
        userId,
        status: JobStatus.processing,
        totalItems: items.length,
        items: {
          create: items.map((inputText) => ({
            userId, // denormalized for safe scoping
            inputText,
            status: ItemStatus.queued,
          })),
        },
      },
      include: { items: { select: { id: true } } },
    });
    return created;
  });

  // Enqueue AFTER the transaction commits so the worker can never pick up an
  // item before it exists in the DB.
  await Promise.all(job.items.map((i) => enqueueItem(i.id)));

  return job;
}

/** List the caller's jobs with status counts (newest first). */
export async function listJobs(userId: string) {
  const jobs = await prisma.job.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { items: { select: { status: true } } },
  });

  return jobs.map((j) => ({
    id: j.id,
    status: j.status,
    totalItems: j.totalItems,
    createdAt: j.createdAt,
    counts: countByStatus(j.items),
  }));
}

/** Full job detail (items + AI results), scoped to the caller. */
export async function getJob(userId: string, jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId },
    include: { items: { orderBy: { updatedAt: "asc" } } },
  });
  if (!job) throw notFound("Job not found.");

  return {
    id: job.id,
    status: job.status,
    totalItems: job.totalItems,
    createdAt: job.createdAt,
    counts: countByStatus(job.items),
    items: job.items,
  };
}

/**
 * Re-enqueue every FAILED item in a job. Scoped to the caller.
 * Resetting status to `queued` + clearing the error makes this safe to call
 * repeatedly; already-running/done items are untouched.
 */
export async function retryFailedItems(userId: string, jobId: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
  if (!job) throw notFound("Job not found.");

  const failed = await prisma.item.findMany({
    where: { jobId, userId, status: ItemStatus.failed },
    select: { id: true },
  });

  if (failed.length === 0) return { retried: 0 };

  await prisma.$transaction([
    prisma.item.updateMany({
      where: { id: { in: failed.map((f) => f.id) } },
      data: { status: ItemStatus.queued, error: null },
    }),
    // Job goes back to processing while the retried items run.
    prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.processing },
    }),
  ]);

  await Promise.all(failed.map((f) => enqueueItem(f.id)));
  return { retried: failed.length };
}

/**
 * Job-level rollup. If no item is still queued/processing, the job is
 * terminal -> mark it completed. Idempotent: safe to call many times.
 */
export async function recomputeJobStatus(jobId: string) {
  const counts = await prisma.item.groupBy({
    by: ["status"],
    where: { jobId },
    _count: true,
  });

  const pending = counts
    .filter(
      (c) => c.status === ItemStatus.queued || c.status === ItemStatus.processing,
    )
    .reduce((sum, c) => sum + c._count, 0);

  if (pending === 0) {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.completed },
    });
  }
}

function countByStatus(items: { status: ItemStatus }[]) {
  const counts = { queued: 0, processing: 0, done: 0, failed: 0 };
  for (const it of items) counts[it.status] += 1;
  return counts;
}
