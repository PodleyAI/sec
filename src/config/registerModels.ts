/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord, ServiceRegistry } from "workglow";
import { getGlobalModelRepository, globalServiceRegistry } from "workglow";
import { SecModelDefault } from "./Constants";

/**
 * Provider discriminator for Anthropic models. Mirrors the `ANTHROPIC` constant
 * the Anthropic provider registers under (in the `providers/anthropic` package,
 * which is not re-exported from `workglow`, so the string is duplicated here).
 * A model's `provider` must equal this for the AI provider registry to route
 * structured generation to Anthropic.
 */
const ANTHROPIC_PROVIDER = "ANTHROPIC";

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
 * The distinct model ids the SEC AI extractors may resolve: the shared default
 * ({@link SecModelDefault}) plus any per-extractor env override that names a
 * different id. Reading the env directly (rather than importing the extractor
 * getters) keeps this config module decoupled from `src/sec/`.
 */
function secModelIds(): string[] {
  const ids = new Set<string>([SecModelDefault]);
  for (const key of ["SEC_S1_MODEL", "SEC_MERGER_PROXY_MODEL", "SEC_REDEMPTION_MODEL"]) {
    const id = process.env[key]?.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Registers the SEC AI models in the global model repository so the extractors
 * can resolve them via `getGlobalModelRepository().findByName(...)`. Covers the
 * shared default (`claude-sonnet-5` unless `SEC_MODEL_DEFAULT` overrides) and any
 * per-extractor override. Idempotent: an id already present is left untouched,
 * so repeat CLI bootstraps are safe and an operator-registered record wins over
 * this default.
 */
export async function registerSecModels(
  registry: ServiceRegistry = globalServiceRegistry
): Promise<void> {
  const repo = getGlobalModelRepository(registry);
  for (const modelId of secModelIds()) {
    if (await repo.findByName(modelId)) continue;
    await repo.addModel(anthropicModelRecord(modelId));
  }
}
