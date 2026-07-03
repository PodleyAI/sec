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

/** Public Anthropic list pricing (standard, non-intro), plus $0 for local models. */
function priceFor(modelId: string): ModelPrice | null {
  if (modelId.includes("/")) return { inputPerM: 0, outputPerM: 0 }; // local (HFT/ONNX)
  if (/opus/i.test(modelId)) return { inputPerM: 5, outputPerM: 25 };
  if (/sonnet/i.test(modelId)) return { inputPerM: 3, outputPerM: 15 };
  if (/haiku/i.test(modelId)) return { inputPerM: 1, outputPerM: 5 };
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
