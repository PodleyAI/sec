/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { getGlobalModelRepository } from "workglow";
import { SecModelDefault } from "../../../../config/Constants";
import { CONFIDENCE_FLOOR, parseConfidenceFloor } from "./sectionRunner";

/**
 * The model id used for risk-factor extraction; overridable via
 * `SEC_S1_RISK_FACTORS_MODEL`. It gets its own knob because the risk-factor
 * section is by far the largest input in the S-1 pipeline and is chunked into
 * several calls, so it dominates per-filing extraction cost — pointing it at a
 * cheaper model while the rest of the filing stays on the default is the
 * reason to separate them.
 */
export function getRiskFactorsModelId(): string {
  const id = (process.env.SEC_S1_RISK_FACTORS_MODEL ?? "").trim();
  return id === "" ? SecModelDefault : id;
}

/** Resolves the configured risk-factor model into a ModelConfig. */
export async function getRiskFactorsModel(): Promise<ModelConfig> {
  const id = getRiskFactorsModelId();
  const record = await getGlobalModelRepository().findByName(id);
  if (!record) {
    throw new Error(
      `Risk-factors model '${id}' is not registered. Register it or set ` +
        `SEC_S1_RISK_FACTORS_MODEL to a known model id.`
    );
  }
  return record as ModelConfig;
}

/**
 * Confidence floor for risk-factor rows. `SEC_S1_RISK_FACTORS_CONFIDENCE_FLOOR`
 * overrides; when unset it falls back to the shared `CONFIDENCE_FLOOR`
 * (`SEC_S1_CONFIDENCE_FLOOR`).
 */
export function getRiskFactorsConfidenceFloor(): number {
  return parseConfidenceFloor(process.env.SEC_S1_RISK_FACTORS_CONFIDENCE_FLOOR, CONFIDENCE_FLOOR);
}
