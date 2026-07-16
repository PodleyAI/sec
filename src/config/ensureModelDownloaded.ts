/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, ModelConfig } from "workglow";
import { ModelDownloadTask } from "workglow";

/**
 * Providers whose weights are fetched from a remote source and cached to disk by
 * a `model.download` run-fn — the local providers. The cloud providers
 * (`ANTHROPIC`, `OPENAI`, `GOOGLE_GEMINI`, `XAI`) register no such run-fn, so a
 * `ModelDownloadTask` for them would throw "no run-fn for provider serving
 * model.download"; downloading is therefore a no-op for anything not listed here.
 */
const DOWNLOADABLE_PROVIDERS = new Set<string>(["HF_TRANSFORMERS_ONNX", "LOCAL_LLAMACPP"]);
const LLAMACPP_PROVIDER = "LOCAL_LLAMACPP";

/**
 * Model ids downloaded (or confirmed ready) in this process. A multi-section run
 * or an eval sweep drives the same model many times; the download run-fn is
 * idempotent but not free (it re-scans/verifies on-disk files and re-emits
 * progress), so we run it at most once per model.
 */
const ensured = new Set<string>();

/** @internal Reset the memo — for tests only. */
export function resetEnsuredModelsForTesting(): void {
  ensured.clear();
}

/**
 * Minimal execution context for driving {@link ModelDownloadTask.execute} outside
 * a full task-graph run. Mirrors the stub used elsewhere for one-shot CLI task
 * execution — download only needs `signal` / `updateProgress` / `own`, with
 * defensive `registry` / `resourceScope` shims.
 */
function makeStubContext(): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: async () => {},
    own: <T>(value: T): T => value,
    registry: {
      has: () => false,
      get: () => {
        throw new Error("not registered");
      },
    } as any,
    resourceScope: { register: () => {}, dispose: async () => {} } as any,
  } as IExecuteContext;
}

/**
 * Ensure a model's weights are present locally before it is used for generation.
 *
 * Providers differ in when weights arrive: cloud models have nothing to download
 * (no-op); HuggingFace ONNX auto-downloads on first generation anyway, so this
 * merely fetches it ahead of the timed work; and node-llama-cpp (GGUF) loads its
 * `model_path` directly and does **not** fetch on generation — so a GGUF model
 * configured with a `model_url` only lands on disk if `ModelDownloadTask` runs
 * first. This helper is the seam every SEC model consumer calls to make that
 * download happen uniformly, whatever the env-configured provider.
 *
 * A GGUF record with only a local `model_path` (no `model_url`) is assumed already
 * on disk — the provider loads it directly and node-llama-cpp's downloader has no
 * URI to fetch — so download is skipped; a missing file surfaces at load time with
 * the provider's own error.
 *
 * Uses {@link ModelDownloadTask} (not the provider run-fn directly) so provider
 * resolution and progress handling stay in the task layer. Memoized per model id.
 */
export async function ensureModelDownloaded(model: ModelConfig): Promise<void> {
  const provider = (model as { provider?: string }).provider;
  if (!provider || !DOWNLOADABLE_PROVIDERS.has(provider)) return;

  const modelId = (model as { model_id?: string }).model_id ?? "";
  if (modelId && ensured.has(modelId)) return;

  if (provider === LLAMACPP_PROVIDER) {
    const config = (model as { provider_config?: { model_url?: string } }).provider_config;
    if (!config?.model_url) {
      // Bare local GGUF path: nothing to fetch. Mark ready so we don't re-check.
      if (modelId) ensured.add(modelId);
      return;
    }
  }

  const input = { model };
  const task = new ModelDownloadTask({ defaults: input } as any);
  await task.execute(input as any, makeStubContext());
  if (modelId) ensured.add(modelId);
}
