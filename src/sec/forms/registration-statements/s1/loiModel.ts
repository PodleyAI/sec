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

/** The model id used for LOI extraction; overridable via SEC_LOI_MODEL. */
export function getLoiModelId(): string {
  const id = (process.env.SEC_LOI_MODEL ?? "").trim();
  return id === "" ? SecModelDefault : id;
}

/** Resolves the configured LOI model into a ModelConfig. */
export async function getLoiModel(): Promise<ModelConfig> {
  const id = getLoiModelId();
  const record = await getGlobalModelRepository().findByName(id);
  if (!record) {
    throw new Error(
      `LOI model '${id}' is not registered. Register it or set SEC_LOI_MODEL to a known model id.`
    );
  }
  return record as ModelConfig;
}

/**
 * Confidence floor for LOI extraction. `SEC_LOI_CONFIDENCE_FLOOR` overrides;
 * when unset it falls back to the shared `CONFIDENCE_FLOOR`
 * (`SEC_S1_CONFIDENCE_FLOOR`).
 */
export function getLoiConfidenceFloor(): number {
  return parseConfidenceFloor(process.env.SEC_LOI_CONFIDENCE_FLOOR, CONFIDENCE_FLOOR);
}
