// Jobs routes (all protected + scoped to the authenticated user).
//   POST /jobs                       -> create a batch (non-blocking)
//   GET  /jobs                       -> list my jobs + counts
//   GET  /jobs/:id                   -> job detail with items + AI results
//   POST /jobs/:id/retry             -> re-enqueue failed items
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { badRequest } from "../lib/errors";
import {
  createJob,
  listJobs,
  getJob,
  retryFailedItems,
} from "./service";

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

// Accept either an array of items, or a newline-separated text blob.
const createSchema = z.object({
  items: z.array(z.string()).optional(),
  text: z.string().optional(),
});

jobsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Provide `items` (array) or `text`.");

    const items =
      parsed.data.items ??
      (parsed.data.text ? parsed.data.text.split("\n") : []);

    // Returns immediately — AI work is offloaded to the worker.
    const job = await createJob(req.auth!.userId, items);
    res.status(201).json({ id: job.id, status: job.status, totalItems: job.totalItems });
  } catch (e) {
    next(e);
  }
});

jobsRouter.get("/", async (req, res, next) => {
  try {
    res.json(await listJobs(req.auth!.userId));
  } catch (e) {
    next(e);
  }
});

jobsRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await getJob(req.auth!.userId, req.params.id));
  } catch (e) {
    next(e);
  }
});

jobsRouter.post("/:id/retry", async (req, res, next) => {
  try {
    res.json(await retryFailedItems(req.auth!.userId, req.params.id));
  } catch (e) {
    next(e);
  }
});
