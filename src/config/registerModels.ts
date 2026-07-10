/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord, ServiceRegistry } from "workglow";
import { getGlobalModelRepository, globalServiceRegistry } from "workglow";
import { SecHftModelDefault, SecModelDefault } from "./Constants";

/**
 * Provider discriminators. Mirror the constants the provider packages register
 * under (`providers/anthropic` → `ANTHROPIC`, `providers/huggingface-transformers`
 * → `HF_TRANSFORMERS_ONNX`); neither is re-exported from `workglow`, so the
 * strings are duplicated here. A model's `provider` must equal one of these for
 * the AI provider registry to route generation to that provider — see
 * `registerSecProviders`.
 */
const ANTHROPIC_PROVIDER = "ANTHROPIC";
const HFT_PROVIDER = "HF_TRANSFORMERS_ONNX";

/** HuggingFace repo ids are `org/name`; Anthropic ids (`claude-*`) never contain `/`. */
function isHftModelId(modelId: string): boolean {
  return modelId.includes("/");
}

/**
 * Default per-response token ceiling recorded on the model. The extractors pass
 * their own `maxTokens`, so this only bounds callers that don't — the Anthropic
 * provider otherwise falls back to 1024, which truncates extraction output.
 */
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Full capability set for an Anthropic chat model, matching what the Anthropic
 * provider infers for the claude-4 family. `StructuredGenerationTask` gates on
 * `json-mode` (and the extractors need `text.generation` / `tool-use`), so the
 * record must declare these — an empty `capabilities` array trips the gate.
 * We set them explicitly rather than lean on `inferAnthropicCapabilities`
 * because the installed provider's id regexes don't yet recognize newer ids
 * like `claude-sonnet-5` and fall back to a bare meta-ops baseline.
 */
const ANTHROPIC_CAPABILITIES: readonly string[] = [
  "text.generation",
  "text.rewriter",
  "text.summary",
  "tool-use",
  "json-mode",
  "vision-input",
  "model.count-tokens",
  "model.info",
  "model.search",
];

/**
 * Builds a fully-specified Anthropic {@link ModelRecord} for a model id. The
 * shape mirrors what the Anthropic provider's own model search emits (provider
 * discriminator + `provider_config.model_name`), so a record registered here is
 * interchangeable with one discovered from the live model list.
 */
export function anthropicModelRecord(modelId: string): ModelRecord {
  return {
    model_id: modelId,
    provider: ANTHROPIC_PROVIDER,
    title: modelId,
    description: `Anthropic ${modelId}`,
    capabilities: [...ANTHROPIC_CAPABILITIES],
    provider_config: { model_name: modelId, max_tokens: DEFAULT_MAX_TOKENS },
    metadata: {},
  };
}

/**
 * Full capability set for a local HFT (ONNX) text-generation model. The provider
 * serves `json-mode` via a dedicated run function, but a text-generation model's
 * *inferred* capabilities omit it — so, as for Anthropic, we declare `json-mode`
 * (plus `text.generation`) explicitly, otherwise `StructuredGenerationTask`'s
 * capability gate rejects the model.
 */
const HFT_CAPABILITIES: readonly string[] = [
  "text.generation",
  "json-mode",
  "tool-use",
  "model.count-tokens",
  "model.download-remove",
  "model.info",
  "model.search",
];

/**
 * Builds a fully-specified HuggingFace Transformers (ONNX) {@link ModelRecord}.
 * `provider_config.model_path` is the HuggingFace repo id (`org/name`), loaded on
 * first use into the worker; `pipeline: "text-generation"` selects the causal-LM
 * pipeline the structured-generation path drives.
 */
export function hftModelRecord(modelId: string): ModelRecord {
  return {
    model_id: modelId,
    provider: HFT_PROVIDER,
    title: modelId,
    description: `HuggingFace Transformers ONNX ${modelId}`,
    capabilities: [...HFT_CAPABILITIES],
    provider_config: {
      model_path: modelId,
      pipeline: "text-generation",
      device: "cpu",
      dtype: "q4",
    },
    metadata: {},
  };
}

/**
 * Builds a provider-appropriate {@link ModelRecord} for a model id, dispatching
 * on id shape: a HuggingFace `org/name` id → HFT (local), otherwise Anthropic
 * (cloud). Shared by {@link registerSecModels} and the `sec eval` harness so both
 * mint identical records for the same id.
 */
export function secModelRecord(modelId: string): ModelRecord {
  return isHftModelId(modelId) ? hftModelRecord(modelId) : anthropicModelRecord(modelId);
}

/**
 * The distinct model ids the SEC pipeline registers: the shared cloud default
 * ({@link SecModelDefault}), any per-extractor env override, and the local HFT
 * default ({@link SecHftModelDefault}, available for `sec eval` comparisons).
 * Reading the env directly (rather than importing the extractor getters) keeps
 * this config module decoupled from `src/sec/`.
 */
function secModelIds(): string[] {
  const ids = new Set<string>([SecModelDefault, SecHftModelDefault]);
  for (const key of ["SEC_S1_MODEL", "SEC_MERGER_PROXY_MODEL", "SEC_REDEMPTION_MODEL"]) {
    const id = process.env[key]?.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Registers `modelIds` in the global model repository so generation can resolve
 * them via `getGlobalModelRepository().findByName(...)`. Idempotent: an id already
 * present is left untouched, so repeat bootstraps are safe and an operator- or
 * harness-registered record wins over this default.
 */
export async function registerModelIds(
  modelIds: readonly string[],
  registry: ServiceRegistry = globalServiceRegistry
): Promise<void> {
  const repo = getGlobalModelRepository(registry);
  for (const modelId of modelIds) {
    if (await repo.findByName(modelId)) continue;
    await repo.addModel(secModelRecord(modelId));
  }
}

/**
 * Registers the SEC AI models (cloud default + overrides + local HFT default) —
 * see {@link secModelIds}. Idempotent.
 */
export async function registerSecModels(
  registry: ServiceRegistry = globalServiceRegistry
): Promise<void> {
  await registerModelIds(secModelIds(), registry);
}
