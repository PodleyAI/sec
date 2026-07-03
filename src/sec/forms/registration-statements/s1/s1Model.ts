/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { getGlobalModelRepository } from "workglow";
import { SecModelDefault } from "../../../../config/Constants";

/** The model id used for S-1 extraction; overridable via SEC_S1_MODEL. */
export function getS1ModelId(): string {
  const id = (process.env.SEC_S1_MODEL ?? "").trim();
  return id === "" ? SecModelDefault : id;
}

/**
 * Resolves the configured S-1 model into a ModelConfig from the global model
 * repository. Throws a clear error if the id isn't registered, so an operator
 * knows to register the model before running extraction.
 */
export async function getS1Model(): Promise<ModelConfig> {
  const id = getS1ModelId();
  const record = await getGlobalModelRepository().findByName(id);
  if (!record) {
    throw new Error(
      `S-1 model '${id}' is not registered. Register it or set SEC_S1_MODEL to a known model id.`
    );
  }
  return record as ModelConfig;
}

/**
 * The model identifier recorded in provenance rows. Production resolves a
 * ModelRecord (keyed `model_id`); the test fake uses `model` — accept either
 * so provenance records the real identifier in both paths.
 */
export function resolveModelId(model: ModelConfig): string | null {
  const ref = model as { model_id?: unknown; model?: unknown };
  return typeof ref.model_id === "string"
    ? ref.model_id
    : typeof ref.model === "string"
      ? ref.model
      : null;
}
