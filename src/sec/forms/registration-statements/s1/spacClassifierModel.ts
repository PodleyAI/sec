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

/** The model ids used for the SPAC content classifier; overridable via SEC_S1_CLASSIFIER_MODEL. */
export function getSpacClassifierModelIds(): string[] {
  return modelIdsFromEnv(process.env.SEC_S1_CLASSIFIER_MODEL);
}

/** First id of {@link getSpacClassifierModelIds}. */
export function getSpacClassifierModelId(): string {
  return getSpacClassifierModelIds()[0]!;
}

/** Resolves the configured SPAC-classifier model list. */
export async function getSpacClassifierModels(): Promise<ModelConfig[]> {
  return resolveConfiguredModels(
    getSpacClassifierModelIds(),
    "SPAC classifier",
    "SEC_S1_CLASSIFIER_MODEL"
  );
}

/** Primary (first) configured SPAC-classifier model. */
export async function getSpacClassifierModel(): Promise<ModelConfig> {
  const [model] = await getSpacClassifierModels();
  return model!;
}

/**
 * Confidence floor for the SPAC content classifier. `SEC_S1_CLASSIFIER_CONFIDENCE_FLOOR`
 * overrides; when unset it falls back to the shared `CONFIDENCE_FLOOR`
 * (`SEC_S1_CONFIDENCE_FLOOR`). A miscoded-SPAC upgrade is a consequential write
 * (it mints a known-SPAC row), so operators can raise this to demand a stronger
 * signal than the general S-1 floor.
 */
export function getSpacClassifierConfidenceFloor(): number {
  return parseConfidenceFloor(process.env.SEC_S1_CLASSIFIER_CONFIDENCE_FLOOR, CONFIDENCE_FLOOR);
}
