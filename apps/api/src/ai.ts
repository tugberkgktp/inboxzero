// AI triage layer.
//
// Falls back to a deterministic local classifier when GROQ_API_KEY is unset, so
// the service has no hard dependency on an external provider for development or
// CI. Inputs containing the token FAIL raise a transient error, which exercises
// the worker's retry and failure-isolation paths without depending on the
// provider actually failing.
import { env } from "./env";

export interface TriageResult {
  category: string;
  priority: number; // 1 (low) .. 5 (urgent)
  sentiment: string; // positive | neutral | negative
  summary: string;
  suggestedReply: string;
}

/** Thrown for transient-style failures that should be retried by BullMQ. */
export class TransientAiError extends Error {}

/**
 * Thrown when the provider rate-limits us (HTTP 429). Carries how long to wait.
 * The worker treats this differently from a normal failure: it pauses the queue
 * and retries WITHOUT consuming one of the item's retry attempts.
 */
export class ProviderRateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`Provider rate limited; retry after ${retryAfterMs}ms`);
  }
}

const CATEGORIES = ["bug", "billing", "feature-request", "spam", "other"];

export async function classify(inputText: string): Promise<TriageResult> {
  // Deterministic failure trigger for exercising retry/failure handling.
  if (inputText.toUpperCase().includes("FAIL")) {
    throw new TransientAiError("Simulated AI failure (item contained 'FAIL')");
  }

  if (env.GROQ_API_KEY) {
    return classifyWithGroq(inputText);
  }
  return classifyWithStub(inputText);
}

/**
 * Groq via its OpenAI-compatible chat completions endpoint.
 * A single classification prompt per item; distinguishes transient failures
 * (429/5xx/network) from permanent ones (4xx) so only the former are retried.
 */
async function classifyWithGroq(inputText: string): Promise<TriageResult> {
  const prompt =
    `You triage support messages. Reply with ONLY a JSON object with keys: ` +
    `category (one of ${CATEGORIES.join(", ")}), priority (integer 1-5), ` +
    `sentiment (positive|neutral|negative), summary (one short sentence), ` +
    `suggested_reply (one short sentence). Message:\n"""${inputText}"""`;

  let res: Response;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });
  } catch (e) {
    // Network blip -> transient -> let BullMQ retry.
    throw new TransientAiError(`Groq request failed: ${(e as Error).message}`);
  }

  if (res.status === 429) {
    // Respect Retry-After (seconds) when present; otherwise back off a few seconds.
    const retryAfter = Number(res.headers.get("retry-after"));
    const ms =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000;
    throw new ProviderRateLimitError(ms);
  }
  if (res.status >= 500) {
    throw new TransientAiError(`Groq transient status ${res.status}`);
  }
  if (!res.ok) {
    // 4xx (bad request, auth) -> not worth retrying.
    throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const raw = JSON.parse(data.choices[0].message.content);
  return normalize(raw, inputText);
}

/** Deterministic, no-key classifier used when no provider is configured. */
async function classifyWithStub(inputText: string): Promise<TriageResult> {
  // Small artificial latency so intermediate status transitions are observable.
  await new Promise((r) => setTimeout(r, 300));

  const text = inputText.toLowerCase();
  const category =
    text.includes("refund") || text.includes("charge") || text.includes("invoice")
      ? "billing"
      : text.includes("crash") || text.includes("error") || text.includes("broken")
        ? "bug"
        : text.includes("please add") || text.includes("would love") || text.includes("feature")
          ? "feature-request"
          : text.includes("http") || text.includes("winner") || text.includes("free money")
            ? "spam"
            : "other";

  const negative = /angry|terrible|worst|hate|broken|crash|refund/.test(text);
  const positive = /thank|great|love|awesome|excellent/.test(text);

  return {
    category,
    priority: category === "bug" ? 4 : category === "billing" ? 3 : 2,
    sentiment: negative ? "negative" : positive ? "positive" : "neutral",
    summary: inputText.trim().slice(0, 80) + (inputText.length > 80 ? "…" : ""),
    suggestedReply:
      "Thanks for reaching out — we've logged this and will follow up shortly.",
  };
}

/** Coerce a model's loose JSON into our strict shape. */
function normalize(raw: any, inputText: string): TriageResult {
  const priority = Number(raw.priority);
  return {
    category: CATEGORIES.includes(raw.category) ? raw.category : "other",
    priority: Number.isFinite(priority) ? Math.min(5, Math.max(1, priority)) : 2,
    sentiment: ["positive", "neutral", "negative"].includes(raw.sentiment)
      ? raw.sentiment
      : "neutral",
    summary: String(raw.summary ?? inputText.slice(0, 80)),
    suggestedReply: String(raw.suggested_reply ?? raw.suggestedReply ?? ""),
  };
}
