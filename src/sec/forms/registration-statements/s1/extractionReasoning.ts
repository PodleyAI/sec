/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig, ModelEffort } from "workglow";
import { MODEL_EFFORTS } from "workglow";

/**
 * Coarse thinking dial for an extraction call — same vocabulary as
 * {@link ModelConfig.effort}. Providers map this onto their native knobs.
 */
export const EXTRACTION_REASONING_EFFORTS = MODEL_EFFORTS;
export type ExtractionReasoningEffort = ModelEffort;

/**
 * Eval-only override that replaces every extractor's baked-in effort for the
 * duration of a sweep. Cleared when set back to `undefined`.
 */
let effortOverride: ExtractionReasoningEffort | undefined;

/** Pin (or clear) the extraction effort override used by {@link withExtractionReasoning}. */
export function setExtractionEffortOverride(effort: ExtractionReasoningEffort | undefined): void {
  effortOverride = effort;
}

/** Current override, if any — exposed for tests. */
export function getExtractionEffortOverride(): ExtractionReasoningEffort | undefined {
  return effortOverride;
}

/**
 * Clone a model config with top-level `effort` set. No-op when `effort` is
 * undefined (leave the registered model as-is). An active
 * {@link setExtractionEffortOverride} wins over the per-extractor argument.
 */
export function withExtractionReasoning(
  model: ModelConfig,
  effort: ExtractionReasoningEffort | undefined
): ModelConfig {
  const effective = effortOverride ?? effort;
  if (effective === undefined) return model;
  return { ...model, effort: effective };
}
