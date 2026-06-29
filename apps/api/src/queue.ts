// BullMQ queue definition + shared Redis connection.
// The API enqueues here; the worker (separate process) consumes from here.
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

export const ITEM_QUEUE = "item-processing";

// BullMQ requires maxRetriesPerRequest: null on the connection it blocks on.
export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export interface ItemJobData {
  itemId: string;
}

export const itemQueue = new Queue<ItemJobData>(ITEM_QUEUE, { connection });

/**
 * Default job options applied to every enqueued item.
 * - attempts + exponential backoff => transient failures are retried.
 * - removeOnComplete/Fail => the queue doesn't retain finished jobs, which
 *   also lets us re-use a deterministic jobId when manually retrying.
 */
export const defaultJobOptions = {
  attempts: env.JOB_ATTEMPTS,
  backoff: { type: "exponential" as const, delay: env.JOB_BACKOFF_MS },
  removeOnComplete: true,
  removeOnFail: true,
};

/**
 * Enqueue one item for processing.
 * jobId = `item-<id>` makes enqueueing idempotent at the QUEUE level: while a
 * job for this item is still pending, a duplicate add is a no-op.
 * (BullMQ reserves ":" in job ids, so we use "-".)
 */
export async function enqueueItem(itemId: string) {
  await itemQueue.add(
    "process-item",
    { itemId },
    { jobId: `item-${itemId}`, ...defaultJobOptions },
  );
}
