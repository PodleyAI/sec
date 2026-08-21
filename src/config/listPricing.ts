/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPricing } from "workglow";

/**
 * Public list pricing for SEC-registered model ids, as {@link ModelPricing}
 * (USD per 1M tokens). Shared by model registration (so the CLI can estimate
 * live spend) and the eval harness (char-approximated costs when a run has no
 * provider usage yet).
 *
 * Hand-maintained — check against each vendor's pricing page before trusting
 * a dollar figure. Unknown / gateway ids return `undefined` so callers report
 * cost as unavailable rather than guessing.
 */

const FREE_LOCAL: ModelPricing = {
  currency: "USD",
  input: 0,
  output: 0,
  cached: 0,
  cacheWrite: 0,
  cacheStoragePerHour: undefined,
};

function rates(
  input: number,
  output: number,
  cached: number | undefined = undefined,
  cacheWrite: number | undefined = undefined
): ModelPricing {
  return {
    currency: "USD",
    input,
    output,
    cached,
    cacheWrite,
    cacheStoragePerHour: undefined,
  };
}

/**
 * OpenAI list pricing. First substring match wins, so more specific ids must
 * come first (`gpt-5.5-pro` before `gpt-5.5`).
 */
const OPENAI_PRICING: ReadonlyArray<readonly [match: string, ModelPricing]> = [
  ["gpt-5.6-sol", rates(5, 30, 0.5)],
  ["gpt-5.6-terra", rates(2.5, 15, 0.25)],
  ["gpt-5.6-luna", rates(0.2, 1.2, 0.02)],
  ["gpt-5.5", rates(5, 30, 2.5)],
  ["gpt-5.4-mini", rates(0.75, 4.5, 0.075)],
  ["gpt-5.4-nano", rates(0.2, 1.25, 0.02)],
];

/**
 * Gemini list pricing (standard base tier). Order is load-bearing: substring
 * `includes`, so `-flash-lite` must precede `-flash`.
 */
const GEMINI_PRICING: ReadonlyArray<readonly [match: string, ModelPricing]> = [
  ["gemini-3.6-flash", rates(1.5, 7.5, 0.375)],
  ["gemini-3.5-flash-lite", rates(0.3, 2.5, 0.075)],
  ["gemini-3.5-flash", rates(1.5, 9, 0.375)],
  ["gemini-3.1-flash-lite", rates(0.25, 1.5, 0.0625)],
  ["gemini-3.1-pro", rates(2, 12, 0.5)],
  ["gemini-3-flash", rates(0.5, 3, 0.125)],
  ["gemini-2.5-flash-lite", rates(0.1, 0.4, 0.025)],
  ["gemini-2.5-flash", rates(0.3, 2.5, 0.075)],
  ["gemini-2.5-pro", rates(1.25, 10, 0.3125)],
];

const XAI_PRICING: ReadonlyArray<readonly [match: string, ModelPricing]> = [
  ["grok-4.6", rates(2, 6, 0.5)],
  ["grok-4.5", rates(2, 6, 0.3)],
];

/**
 * DeepSeek cache-miss input price — each extraction section is a distinct
 * prompt, so the hit rate would understate real cost by ~50x.
 */
const DEEPSEEK_PRICING: ReadonlyArray<readonly [match: string, ModelPricing]> = [
  ["deepseek-v4-flash", rates(0.14, 0.28, 0.014)],
  ["deepseek-v4-flash-0731", rates(0.14, 0.28, 0.014)],
  ["deepseek-v4-pro-0813", rates(0.435, 0.87, 0.0435)],
  ["deepseek-v4-pro", rates(0.435, 0.87, 0.0435)],
];

/**
 * Resolve list pricing for a model id. Local ONNX / GGUF ids are $0; prefixed
 * cloud gateways (`hfi:`, `open-router:`) and unrecognized ids are unpriced.
 */
export function listPricingForModelId(modelId: string): ModelPricing | undefined {
  if (modelId === "deterministic") return FREE_LOCAL;
  if (modelId.startsWith("onnx:")) return FREE_LOCAL;
  if (/^(gguf:|llama:|node-llama:)/.test(modelId)) return FREE_LOCAL;
  if (modelId.startsWith("hfi:") || modelId.startsWith("open-router:")) return undefined;

  if (/opus/i.test(modelId)) return rates(5, 25, 0.5, 6.25);
  if (/sonnet-5/i.test(modelId)) return rates(2, 10, 0.2, 2.5);
  if (/sonnet/i.test(modelId)) return rates(3, 15, 0.3, 3.75);
  if (/haiku/i.test(modelId)) return rates(1, 5, 0.1, 1.25);

  const id = modelId.toLowerCase();
  for (const table of [OPENAI_PRICING, GEMINI_PRICING, XAI_PRICING, DEEPSEEK_PRICING]) {
    const hit = table.find(([match]) => id.includes(match));
    if (hit) return hit[1];
  }
  return undefined;
}
