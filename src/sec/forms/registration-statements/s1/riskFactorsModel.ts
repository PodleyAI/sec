/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { modelIdsFromEnv } from "../../../../config/Constants";
import { resolveConfiguredModels, resolveModelId } from "./s1Model";
import { CONFIDENCE_FLOOR, parseConfidenceFloor } from "./sectionRunner";

export { resolveModelId };

/**
 * The model ids used for risk-factor extraction; overridable via
 * `SEC_S1_RISK_FACTORS_MODEL` (CSV). It gets its own knob because the
 * risk-factor section is by far the largest input in the S-1 pipeline and is
 * chunked into several calls, so it dominates per-filing extraction cost —
 * pointing it at a cheaper model (or a cheaper fallback list) while the rest
 * of the filing stays on the default is the reason to separate them.
 */
export function getRiskFactorsModelIds(): string[] {
  return modelIdsFromEnv(process.env.SEC_S1_RISK_FACTORS_MODEL);
}

export function getRiskFactorsModelId(): string {
  return getRiskFactorsModelIds()[0]!;
}

/** Resolves the configured risk-factor model list. */
export async function getRiskFactorsModels(): Promise<ModelConfig[]> {
  return resolveConfiguredModels(
    getRiskFactorsModelIds(),
    "Risk-factors",
    "SEC_S1_RISK_FACTORS_MODEL"
  );
}

/** Primary (first) configured risk-factor model. */
export async function getRiskFactorsModel(): Promise<ModelConfig> {
  const [model] = await getRiskFactorsModels();
  return model!;
}

/**
 * Confidence floor for risk-factor rows. `SEC_S1_RISK_FACTORS_CONFIDENCE_FLOOR`
 * overrides; when unset it falls back to the shared `CONFIDENCE_FLOOR`
 * (`SEC_S1_CONFIDENCE_FLOOR`).
 */
export function getRiskFactorsConfidenceFloor(): number {
  return parseConfidenceFloor(process.env.SEC_S1_RISK_FACTORS_CONFIDENCE_FLOOR, CONFIDENCE_FLOOR);
}
