/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { getGlobalModelRepository } from "workglow";
import { SecModelDefault } from "../../../../config/Constants";
import { resolveModelId } from "./s1Model";
import { CONFIDENCE_FLOOR, parseConfidenceFloor } from "./sectionRunner";

export { resolveModelId };

/** The model id used for the SPAC content classifier; overridable via SEC_S1_CLASSIFIER_MODEL. */
export function getSpacClassifierModelId(): string {
  const id = (process.env.SEC_S1_CLASSIFIER_MODEL ?? "").trim();
  return id === "" ? SecModelDefault : id;
}

/** Resolves the configured SPAC-classifier model into a ModelConfig. */
export async function getSpacClassifierModel(): Promise<ModelConfig> {
  const id = getSpacClassifierModelId();
  const record = await getGlobalModelRepository().findByName(id);
  if (!record) {
    throw new Error(
      `SPAC classifier model '${id}' is not registered. Register it or set ` +
        `SEC_S1_CLASSIFIER_MODEL to a known model id.`
    );
  }
  return record as ModelConfig;
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
