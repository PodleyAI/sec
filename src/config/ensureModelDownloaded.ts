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
 * Stable per-model memo key. Mirrors `resolveModelId` (`model_id ?? model`) — not
 * every ModelConfig carries `model_id` (some identify via `model`) — and falls
 * back to the provider_config download/load target so a record with neither still
 * memoizes on something unique (`model_url` for a remote GGUF, `model_path` for a
 * local one / HFT repo id). Empty only for a truly anonymous record, which then
 * downloads every call rather than being wrongly deduped against another.
 */
function modelKey(model: ModelConfig): string {
  const ref = model as {
    model_id?: unknown;
    model?: unknown;
    provider_config?: { model_url?: unknown; model_path?: unknown };
  };
  const candidates = [
    ref.model_id,
    ref.model,
    ref.provider_config?.model_url,
    ref.provider_config?.model_path,
  ];
  const found = candidates.find((c): c is string => typeof c === "string" && c.length > 0);
  return found ?? "";
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
 * `context` is the running task's {@link IExecuteContext}. Passing the real one
 * (rather than a throwaway stub) is what surfaces download progress: the download
 * run-fn's `phase` events are forwarded to `context.updateProgress`, which the
 * CLI progress UI (`withCli`) renders — so a multi-GB GGUF/ONNX fetch shows a live
 * percentage instead of a silent hang. `context.signal` also aborts a long
 * download on Ctrl-C. Memoized per model id, so a per-section sweep pays it once.
 */
export async function ensureModelDownloaded(
  model: ModelConfig,
  context: IExecuteContext
): Promise<void> {
  const provider = (model as { provider?: string }).provider;
  if (!provider || !DOWNLOADABLE_PROVIDERS.has(provider)) return;

  const modelId = modelKey(model);
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
  // Drive the download through its `run()` lifecycle. `run` routes the download
  // run-fn's `phase` events to `config.updateProgress`, which we forward to the
  // caller's `context.updateProgress` so a multi-GB fetch renders a live
  // percentage in the CLI task UI; `signal` aborts it on Ctrl-C.
  await task.run(input as any, {
    updateProgress: (_t, progress, message) => context.updateProgress(progress, message),
    signal: context.signal,
  });
  if (modelId) ensured.add(modelId);
}

/**
 * Best-effort prefetch used at the CLI-task boundary (form processors, eval
 * sweeps) to surface download progress before the work begins. No-ops when there
 * is no model or no context (a direct/test caller), and swallows failures — the
 * downstream generation path re-attempts via {@link ensureModelDownloaded} and
 * records the failure in its own way (dead-letter or failed eval run), so a
 * prefetch problem must never abort the run. Whether it downloads with a visible
 * progress bar is decided entirely by whether a real `context` is threaded in.
 */
export async function prefetchModel(
  model: ModelConfig | null | undefined,
  context: IExecuteContext | undefined
): Promise<void> {
  if (!model || !context) return;
  try {
    await ensureModelDownloaded(model, context);
  } catch {
    // Downstream generation re-attempts the download and records any failure.
  }
}
