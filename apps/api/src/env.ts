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

  // Proactive AI rate limit: at most AI_RATE_MAX calls per AI_RATE_DURATION_MS,
  // sized to stay under the provider's free-tier limit and avoid 429s.
  AI_RATE_MAX: z.coerce.number().default(20),
  AI_RATE_DURATION_MS: z.coerce.number().default(60_000),

  // Guards on batch size and per-item length (bounds token usage and abuse).
  MAX_BATCH_ITEMS: z.coerce.number().default(50),
  MAX_ITEM_CHARS: z.coerce.number().default(4000),

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

// In production, refuse to boot with a weak or default signing secret so a
// deploy can never silently run with forgeable tokens.
if (env.NODE_ENV === "production") {
  const weak =
    env.JWT_SECRET.length < 32 ||
    /change-me|dev-secret|secret/i.test(env.JWT_SECRET);
  if (weak) {
    console.error(
      "Refusing to start: JWT_SECRET must be a strong (>=32 char) random value in production.",
    );
    process.exit(1);
  }
}
