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

/** The model ids used for merger-proxy extraction; overridable via SEC_MERGER_PROXY_MODEL. */
export function getMergerProxyModelIds(): string[] {
  return modelIdsFromEnv(process.env.SEC_MERGER_PROXY_MODEL);
}

export function getMergerProxyModelId(): string {
  return getMergerProxyModelIds()[0]!;
}

/** Resolves the configured merger-proxy model list. */
export async function getMergerProxyModels(): Promise<ModelConfig[]> {
  return resolveConfiguredModels(
    getMergerProxyModelIds(),
    "Merger-proxy",
    "SEC_MERGER_PROXY_MODEL"
  );
}

/** Primary (first) configured merger-proxy model. */
export async function getMergerProxyModel(): Promise<ModelConfig> {
  const [model] = await getMergerProxyModels();
  return model!;
}

/**
 * Confidence floor for merger-proxy extraction. `SEC_MERGER_PROXY_CONFIDENCE_FLOOR`
 * overrides; when unset it falls back to the shared `CONFIDENCE_FLOOR`
 * (`SEC_S1_CONFIDENCE_FLOOR`), so behavior is unchanged unless explicitly set.
 */
export function getMergerProxyConfidenceFloor(): number {
  return parseConfidenceFloor(process.env.SEC_MERGER_PROXY_CONFIDENCE_FLOOR, CONFIDENCE_FLOOR);
}
