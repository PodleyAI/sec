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
  ["gpt-5.6-luna", { inputPerM: 0.2, outputPerM: 1.2 }],
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
  // Order is load-bearing: the lookup is a substring `includes`, so a
  // `-flash-lite` id would otherwise be priced as `-flash`.
  ["gemini-3.6-flash", { inputPerM: 1.5, outputPerM: 7.5 }],
  ["gemini-3.5-flash-lite", { inputPerM: 0.3, outputPerM: 2.5 }],
  ["gemini-3.5-flash", { inputPerM: 1.5, outputPerM: 9 }],
  ["gemini-3.1-flash-lite", { inputPerM: 0.25, outputPerM: 1.5 }],
  ["gemini-3.1-pro", { inputPerM: 2, outputPerM: 12 }],
  ["gemini-3-flash", { inputPerM: 0.5, outputPerM: 3 }],
  ["gemini-2.5-flash-lite", { inputPerM: 0.1, outputPerM: 0.4 }],
  ["gemini-2.5-flash", { inputPerM: 0.3, outputPerM: 2.5 }],
  ["gemini-2.5-pro", { inputPerM: 1.25, outputPerM: 10 }],
];

/** xAI Grok list pricing (USD per 1M tokens). */
const XAI_PRICING: ReadonlyArray<readonly [match: string, price: ModelPrice]> = [
  ["grok-4.5", { inputPerM: 2, outputPerM: 6 }],
];

/**
 * DeepSeek list pricing (USD per 1M tokens), from
 * https://api-docs.deepseek.com/quick_start/pricing.
 *
 * DeepSeek quotes two input prices — cache hit and cache miss. We use the
 * **cache-miss** figure: each eval section is a distinct prompt, so a fresh
 * extraction never hits the context cache, and the hit price (~50x cheaper)
 * would understate real cost by two orders of magnitude. DeepSeek has also
 * announced 2x peak-hour pricing (09:00–12:00 and 14:00–18:00 Beijing time),
 * not yet in effect; this table is the off-peak/base rate.
 */
const DEEPSEEK_PRICING: ReadonlyArray<readonly [match: string, price: ModelPrice]> = [
  ["deepseek-v4-flash", { inputPerM: 0.14, outputPerM: 0.28 }],
  ["deepseek-v4-pro", { inputPerM: 0.435, outputPerM: 0.87 }],
];

/**
 * Public list pricing (standard, non-intro): Anthropic by family, the cloud
 * vendors by id-substring table, and $0 for local models. Returns null for an
 * unknown id so the harness reports cost as unavailable rather than guessing.
 */
function priceFor(modelId: string): ModelPrice | null {
  if (modelId.startsWith("onnx:")) return { inputPerM: 0, outputPerM: 0 }; // local (HFT/ONNX)
  if (/^(gguf:|llama:|node-llama:)/.test(modelId)) return { inputPerM: 0, outputPerM: 0 }; // local (llama.cpp)
  // Prefixed cloud gateways — pricing is provider-specific and not tabulated here.
  if (modelId.startsWith("hfi:") || modelId.startsWith("open-router:")) return null;
  if (/opus/i.test(modelId)) return { inputPerM: 5, outputPerM: 25 };
  if (/sonnet/i.test(modelId)) return { inputPerM: 3, outputPerM: 15 };
  if (/haiku/i.test(modelId)) return { inputPerM: 1, outputPerM: 5 };
  const id = modelId.toLowerCase();
  for (const table of [OPENAI_PRICING, GEMINI_PRICING, XAI_PRICING, DEEPSEEK_PRICING]) {
    const hit = table.find(([match]) => id.includes(match));
    if (hit) return hit[1];
  }
  return null; // unknown id → cost unavailable
}

const CHARS_PER_TOKEN = 4;

/** Estimated token count for a character count (~4 chars/token). */
function tokensForChars(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Estimated token count for a chunk of text (~4 chars/token). */
export function estimateTokens(text: string): number {
  return tokensForChars(text.length);
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
  const inputTokens = tokensForChars(promptChars);
  const outputTokens = tokensForChars(outputChars);
  const price = priceFor(modelId);
  const usd =
    price === null
      ? null
      : (inputTokens / 1_000_000) * price.inputPerM +
        (outputTokens / 1_000_000) * price.outputPerM;
  return { inputTokens, outputTokens, usd };
}
