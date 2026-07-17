/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rough per-model cost estimation for the `sec eval` harness. The generation
 * task does not surface token usage, so cost is an **estimate**: tokens are
 * approximated from character counts (~4 chars/token) and multiplied by public
 * per-million pricing. Absolute dollars are approximate; the value is in the
 * *relative* ranking across models on the same fixtures, which the estimate
 * preserves (same text → same input estimate; price is the dominant differ).
 */

export interface ModelPrice {
  /** USD per 1M input tokens. */
  readonly inputPerM: number;
  /** USD per 1M output tokens. */
  readonly outputPerM: number;
}

/**
 * OpenAI list pricing (USD per 1M tokens, standard non-cached), keyed by a
 * substring of the model id. First match wins, so **more specific ids must come
 * first** (`gpt-5.5-pro` before `gpt-5.5`, since `"gpt-5.5-pro".includes("gpt-5.5")`).
 * ids verified against `GET /v1/models`: there is no `gpt-5.5-mini` — the whole
 * 5.5 line has no mini/nano SKU; the small models are `gpt-5.4-mini`/`-nano` and
 * the newest line is `gpt-5.6-{sol,terra,luna}`. Update here when pricing changes.
 */
const OPENAI_PRICING: ReadonlyArray<readonly [match: string, price: ModelPrice]> = [
  ["gpt-5.6-sol", { inputPerM: 5, outputPerM: 30 }],
  ["gpt-5.6-terra", { inputPerM: 2.5, outputPerM: 15 }],
  ["gpt-5.6-luna", { inputPerM: 1, outputPerM: 6 }],
  ["gpt-5.5", { inputPerM: 5, outputPerM: 30 }],
  ["gpt-5.4-mini", { inputPerM: 0.75, outputPerM: 4.5 }],
  ["gpt-5.4-nano", { inputPerM: 0.2, outputPerM: 1.25 }],
];

/**
 * Google Gemini list pricing (USD per 1M tokens, standard base tier — the
 * long-context premium above ~200k tokens is ignored; S-1 sections are far
 * under). Substring match, most specific first (`-flash-lite` before `-flash`).
 */
const GEMINI_PRICING: ReadonlyArray<readonly [match: string, price: ModelPrice]> = [
  ["gemini-3.1-flash-lite", { inputPerM: 0.25, outputPerM: 1.5 }],
  ["gemini-3.1-pro", { inputPerM: 2, outputPerM: 12 }],
  ["gemini-3-flash", { inputPerM: 0.5, outputPerM: 3 }],
];

/** xAI Grok list pricing (USD per 1M tokens). */
const XAI_PRICING: ReadonlyArray<readonly [match: string, price: ModelPrice]> = [
  ["grok-4.5", { inputPerM: 2, outputPerM: 6 }],
];

/**
 * Public list pricing (standard, non-intro): Anthropic by family, OpenAI by
 * id-substring table, and $0 for local models. Returns null for an unknown id so
 * the harness reports cost as unavailable rather than guessing.
 */
function priceFor(modelId: string): ModelPrice | null {
  if (modelId.includes("/")) return { inputPerM: 0, outputPerM: 0 }; // local (HFT/ONNX)
  if (modelId.startsWith("gguf:")) return { inputPerM: 0, outputPerM: 0 }; // local (llama.cpp)
  if (/opus/i.test(modelId)) return { inputPerM: 5, outputPerM: 25 };
  if (/sonnet/i.test(modelId)) return { inputPerM: 3, outputPerM: 15 };
  if (/haiku/i.test(modelId)) return { inputPerM: 1, outputPerM: 5 };
  const id = modelId.toLowerCase();
  for (const table of [OPENAI_PRICING, GEMINI_PRICING, XAI_PRICING]) {
    const hit = table.find(([match]) => id.includes(match));
    if (hit) return hit[1];
  }
  return null; // unknown id → cost unavailable
}

const CHARS_PER_TOKEN = 4;

/** Estimated token count for a chunk of text (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface CostEstimate {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Estimated USD for this call, or null when the model's pricing is unknown. */
  readonly usd: number | null;
}

/**
 * Estimate the cost of one extraction call. `promptChars` approximates the input
 * (section text + instruction overhead); `outputChars` is the serialized result.
 */
export function estimateCost(
  modelId: string,
  promptChars: number,
  outputChars: number
): CostEstimate {
  const inputTokens = estimateTokens("x".repeat(promptChars));
  const outputTokens = estimateTokens("x".repeat(outputChars));
  const price = priceFor(modelId);
  const usd =
    price === null
      ? null
      : (inputTokens / 1_000_000) * price.inputPerM +
        (outputTokens / 1_000_000) * price.outputPerM;
  return { inputTokens, outputTokens, usd };
}
