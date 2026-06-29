// Express app factory. Kept separate from server startup so it's easy to test.
import express, { ErrorRequestHandler } from "express";
import cors from "cors";
import { authRouter } from "./auth/routes";
import { jobsRouter } from "./jobs/routes";
import { HttpError } from "./lib/errors";
import { env } from "./env";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/auth", authRouter);
  app.use("/jobs", jobsRouter);

  // Central error handler -> consistent JSON error responses.
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(errorHandler);

  return app;
}
