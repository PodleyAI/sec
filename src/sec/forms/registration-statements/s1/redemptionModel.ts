/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { modelIdsFromEnv } from "../../../../config/Constants";
import {
  modelExtractChain,
  persistModelId,
  resolveConfiguredModels,
  resolveModelId,
} from "./s1Model";
import { CONFIDENCE_FLOOR, parseConfidenceFloor } from "./sectionRunner";

export { modelExtractChain, persistModelId, resolveModelId };

/** The model ids used for redemption extraction; overridable via SEC_REDEMPTION_MODEL. */
export function getRedemptionModelIds(): string[] {
  return modelIdsFromEnv(process.env.SEC_REDEMPTION_MODEL, { appendDefaultFallbacks: true });
}

export function getRedemptionModelId(): string {
  return getRedemptionModelIds()[0]!;
}

/** Resolves the configured redemption model list. */
export async function getRedemptionModels(): Promise<ModelConfig[]> {
  return resolveConfiguredModels(getRedemptionModelIds(), "Redemption", "SEC_REDEMPTION_MODEL");
}

/** Primary (first) configured redemption model. */
export async function getRedemptionModel(): Promise<ModelConfig> {
  const [model] = await getRedemptionModels();
  return model!;
}

/**
 * Confidence floor for redemption extraction. `SEC_REDEMPTION_CONFIDENCE_FLOOR`
 * overrides; when unset it falls back to the shared `CONFIDENCE_FLOOR`
 * (`SEC_S1_CONFIDENCE_FLOOR`).
 */
export function getRedemptionConfidenceFloor(): number {
  return parseConfidenceFloor(process.env.SEC_REDEMPTION_CONFIDENCE_FLOOR, CONFIDENCE_FLOOR);
}
