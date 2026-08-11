/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { estimateCost as estimateUsageCost } from "workglow";
import type { Usage } from "workglow";
import { listPricingForModelId } from "../config/listPricing";

/**
 * Char-approximated cost for the `sec eval` harness when a generation call has
 * not yet surfaced provider {@link Usage}. Tokens are estimated at ~4
 * chars/token, then priced through the shared {@link listPricingForModelId}
 * rate card and `@workglow/ai`'s `estimateCost` — the same path the CLI uses
 * for live spend once real usage arrives.
 *
 * Absolute dollars are approximate; the value is in the *relative* ranking
 * across models on the same fixtures (same text → same input estimate; price
 * is the dominant differ). Prefer {@link costFromUsage} when a call returned
 * real usage (OpenRouter's stated `extra.cost`, billed token counts).
 */

const CHARS_PER_TOKEN = 4;

/** Estimated token count for a character count (~4 chars/token). */
function tokensForChars(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Estimated token count for a chunk of text (~4 chars/token). */
export function estimateTokens(text: string): number {
  return tokensForChars(text.length);
}

/**
 * Eval-table cost row. Distinct from `@workglow/ai`'s `CostEstimate` (which
 * carries currency / unpriced / stated) — the harness tables want token counts
 * beside a nullable USD figure.
 */
export interface CostEstimate {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Estimated USD for this call, or null when the model's pricing is unknown. */
  readonly usd: number | null;
}

/** Whole-prompt token count when the provider stated any prompt slice. */
function promptTokens(usage: Usage): number | undefined {
  const slices = [usage.input, usage.cached, usage.cacheWrite];
  if (slices.every((slice) => slice === undefined)) return undefined;
  return slices.reduce<number>((sum, slice) => sum + (slice ?? 0), 0);
}

/**
 * Prefer provider-stated spend (OpenRouter `extra.cost`, real token counters)
 * when a call returned {@link Usage}; fall back to the char×rate-card estimate
 * when usage is missing or carries no priceable signal.
 */
export function costFromUsage(
  usage: Usage | undefined,
  modelId: string,
  promptChars: number,
  outputChars: number
): CostEstimate {
  if (!usage) return estimateCost(modelId, promptChars, outputChars);

  const stated = usage.extra?.cost;
  const inputTokens = promptTokens(usage) ?? tokensForChars(promptChars);
  const outputTokens = usage.output ?? tokensForChars(outputChars);

  if (typeof stated === "number" && Number.isFinite(stated)) {
    return { inputTokens, outputTokens, usd: stated };
  }

  const priced = estimateUsageCost(usage, listPricingForModelId(modelId));
  if (priced !== undefined) {
    return { inputTokens, outputTokens, usd: priced.amount };
  }

  // Usage arrived without a stated cost and without a rate card — keep the
  // real token counts but leave USD unknown rather than inventing a char estimate.
  if (promptTokens(usage) !== undefined || usage.output !== undefined) {
    return { inputTokens, outputTokens, usd: null };
  }

  return estimateCost(modelId, promptChars, outputChars);
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
  const usage: Usage = {
    input: inputTokens,
    output: outputTokens,
    cached: undefined,
    cacheWrite: undefined,
    reasoning: undefined,
    total: undefined,
    extra: undefined,
  };
  const priced = estimateUsageCost(usage, listPricingForModelId(modelId));
  return {
    inputTokens,
    outputTokens,
    usd: priced === undefined ? null : priced.amount,
  };
}
