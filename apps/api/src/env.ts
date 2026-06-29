// Centralized, validated environment config.
// Everything that reads process.env goes through here so misconfiguration
// fails loudly at startup instead of mysteriously at runtime.
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // AI: optional. When absent, the worker uses a deterministic stub so the
  // whole async pipeline runs with no API key.
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),

  // Worker tuning.
  WORKER_CONCURRENCY: z.coerce.number().default(3),
  JOB_ATTEMPTS: z.coerce.number().default(3),
  JOB_BACKOFF_MS: z.coerce.number().default(1000),

  // Max items accepted per batch (spec suggests 20-50).
  MAX_BATCH_ITEMS: z.coerce.number().default(50),

  // CORS origin for the deployed frontend (comma-separated allowed).
  CORS_ORIGIN: z.string().default("*"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
