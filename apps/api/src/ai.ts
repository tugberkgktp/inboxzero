// AI triage layer.
//
// Two important design choices for this challenge:
//  1. If GROQ_API_KEY is missing, we fall back to a DETERMINISTIC STUB so the
//     entire async pipeline (queue/retries/idempotency/rollup) can be tested
//     and demoed with zero API key and zero cost.
//  2. The FAIL simulation: any item whose text contains "FAIL" throws, so we
//     can demonstrate retries + failure isolation + manual retry on demand.
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

const CATEGORIES = ["bug", "billing", "feature-request", "spam", "other"];

export async function classify(inputText: string): Promise<TriageResult> {
  // Demo hook: simulate a failing item. Documented in the README.
  if (inputText.toUpperCase().includes("FAIL")) {
    throw new TransientAiError("Simulated AI failure (item contained 'FAIL')");
  }

  if (env.GROQ_API_KEY) {
    return classifyWithGroq(inputText);
  }
  return classifyWithStub(inputText);
}

/**
 * Real provider: Groq (OpenAI-compatible chat completions).
 * Kept intentionally trivial — one cheap classification prompt per item.
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

  if (res.status === 429 || res.status >= 500) {
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

/** Deterministic, no-key stub. Good enough to demo the whole pipeline. */
async function classifyWithStub(inputText: string): Promise<TriageResult> {
  // Tiny artificial latency so status transitions are visible in the UI.
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
