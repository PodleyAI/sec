/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { getGlobalModelRepository } from "workglow";
import { modelIdsFromEnv } from "../../../../config/Constants";
import type { RunSectionArgs } from "./sectionRunner";

/** The model ids used for S-1 extraction; overridable via SEC_S1_MODEL (CSV). */
export function getS1ModelIds(): string[] {
  return modelIdsFromEnv(process.env.SEC_S1_MODEL);
}

/** First id of {@link getS1ModelIds}. */
export function getS1ModelId(): string {
  return getS1ModelIds()[0]!;
}

/**
 * Resolves a CSV model list. An unregistered first id throws (same as a scalar
 * miss). Later unregistered ids are skipped with a warning so a typo'd fallback
 * does not abort a section the primary already served.
 */
export async function resolveConfiguredModels(
  ids: readonly string[],
  kind: string,
  hint: string
): Promise<ModelConfig[]> {
  const out: ModelConfig[] = [];
  for (const id of ids) {
    const record = await getGlobalModelRepository().findByName(id);
    if (!record) {
      if (out.length === 0) {
        throw new Error(
          `${kind} model '${id}' is not registered. Register it or set ${hint} to a known model id.`
        );
      }
      console.warn(`${kind} model '${id}' is not registered; skipping`);
      continue;
    }
    out.push(record as ModelConfig);
  }
  return out;
}

/**
 * Resolves the configured S-1 model list into ModelConfigs from the global
 * model repository. Throws a clear error if the primary id isn't registered,
 * so an operator knows to register the model before running extraction.
 */
export async function getS1Models(): Promise<ModelConfig[]> {
  return resolveConfiguredModels(getS1ModelIds(), "S-1", "SEC_S1_MODEL");
}

/** Primary (first) configured S-1 model. */
export async function getS1Model(): Promise<ModelConfig> {
  const [model] = await getS1Models();
  return model!;
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

/** Provenance id for the extract that produced the persisted rows. */
export function persistModelId(models: readonly ModelConfig[], modelIndex: number): string | null {
  return resolveModelId(models[modelIndex] ?? models[0]!);
}

/**
 * Primary extract plus fallbacks for {@link makeRunSection}. Later models run
 * when the previous extract returned `[]` **or threw** a provider/extraction
 * error (abort, config, and mixed-shape re-asks stay on the throwing model).
 */
export function modelExtractChain<TRow extends { confidence: number }>(
  models: readonly ModelConfig[],
  extract: (text: string, model: ModelConfig) => Promise<TRow[]>
): Pick<RunSectionArgs<TRow>, "extract" | "emptyExtracts" | "modelIds"> {
  const primary = models[0];
  if (primary === undefined) {
    throw new Error("modelExtractChain requires at least one model");
  }
  return {
    extract: (text) => extract(text, primary),
    emptyExtracts: models.slice(1).map((m) => (text: string) => extract(text, m)),
    modelIds: models.map((m) => resolveModelId(m)).filter((id): id is string => id !== null),
  };
}
