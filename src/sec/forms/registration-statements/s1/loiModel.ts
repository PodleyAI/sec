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

/** The model ids used for LOI extraction; overridable via SEC_LOI_MODEL. */
export function getLoiModelIds(): string[] {
  return modelIdsFromEnv(process.env.SEC_LOI_MODEL, { appendDefaultFallbacks: true });
}

/** First id of {@link getLoiModelIds}. */
export function getLoiModelId(): string {
  return getLoiModelIds()[0]!;
}

/** Resolves the configured LOI model list. */
export async function getLoiModels(): Promise<ModelConfig[]> {
  return resolveConfiguredModels(getLoiModelIds(), "LOI", "SEC_LOI_MODEL");
}

/** Primary (first) configured LOI model. */
export async function getLoiModel(): Promise<ModelConfig> {
  const [model] = await getLoiModels();
  return model!;
}

/**
 * Confidence floor for LOI extraction. `SEC_LOI_CONFIDENCE_FLOOR` overrides;
 * when unset it falls back to the shared `CONFIDENCE_FLOOR`
 * (`SEC_S1_CONFIDENCE_FLOOR`).
 */
export function getLoiConfidenceFloor(): number {
  return parseConfidenceFloor(process.env.SEC_LOI_CONFIDENCE_FLOOR, CONFIDENCE_FLOOR);
}
