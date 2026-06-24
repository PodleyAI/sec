/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { getGlobalModelRepository } from "workglow";
import { resolveModelId } from "./s1Model";
import { CONFIDENCE_FLOOR, parseConfidenceFloor } from "./sectionRunner";

export { resolveModelId };

const DEFAULT_REDEMPTION_MODEL = "claude-sonnet-4-6";

/** The model id used for redemption extraction; overridable via SEC_REDEMPTION_MODEL. */
export function getRedemptionModelId(): string {
  const id = (process.env.SEC_REDEMPTION_MODEL ?? "").trim();
  return id === "" ? DEFAULT_REDEMPTION_MODEL : id;
}

/** Resolves the configured redemption model into a ModelConfig. */
export async function getRedemptionModel(): Promise<ModelConfig> {
  const id = getRedemptionModelId();
  const record = await getGlobalModelRepository().findByName(id);
  if (!record) {
    throw new Error(
      `Redemption model '${id}' is not registered. Register it or set SEC_REDEMPTION_MODEL to a known model id.`
    );
  }
  return record as ModelConfig;
}

/**
 * Confidence floor for redemption extraction. `SEC_REDEMPTION_CONFIDENCE_FLOOR`
 * overrides; when unset it falls back to the shared `CONFIDENCE_FLOOR`
 * (`SEC_S1_CONFIDENCE_FLOOR`).
 */
export function getRedemptionConfidenceFloor(): number {
  return parseConfidenceFloor(process.env.SEC_REDEMPTION_CONFIDENCE_FLOOR, CONFIDENCE_FLOOR);
}
