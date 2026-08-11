/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { IExecuteContext, ModelDownloadTask, ModelInfoTask, Task } from "workglow";
import { trySecModelRecord } from "../../config/registerModels";

/**
 * Providers whose weights are fetched from a remote source and cached to disk by
 * a `model.download` run-fn — the local providers. The cloud providers
 * (`ANTHROPIC`, `OPENAI`, `GOOGLE_GEMINI`, `XAI`, `DEEPSEEK`, `HF_INFERENCE`,
 * `OPENROUTER`) register no such run-fn; for those this task verifies the model
 * exists via `ModelInfoTask` instead.
 */
const DOWNLOADABLE_PROVIDERS = new Set<string>(["HF_TRANSFORMERS_ONNX", "LOCAL_LLAMACPP"]);
const LLAMACPP_PROVIDER = "LOCAL_LLAMACPP";

/**
 * Cloud API providers whose readiness check is a live `model.info` existence
 * verify rather than a weight download.
 */
const VERIFYABLE_PROVIDERS = new Set<string>([
  "ANTHROPIC",
  "OPENAI",
  "GOOGLE_GEMINI",
  "XAI",
  "DEEPSEEK",
  "HF_INFERENCE",
  "OPENROUTER",
]);

/**
 * Model ids downloaded / verified — or settled as needing neither — in this
 * process. A multi-section run or an eval sweep drives the same model many
 * times; the download/verify run-fn is idempotent but not free, so we run it
 * at most once per model id on success. Failures are not memoized so a later
 * retry can succeed after a key/network fix.
 */
const ensured = new Set<string>();

/** @internal Reset the memo — for tests only. */
export function resetEnsuredModelsForTesting(): void {
  ensured.clear();
}

const InputSchema = () =>
  Type.Object({
    model: Type.String({
      title: "Model id",
      description: "The model name/id to download (local) or verify (API) before generation",
    }),
  });
export type EnsureModelDownloadedInput = Static<ReturnType<typeof InputSchema>>;

const OutputSchema = () =>
  Type.Object({
    /** True when a `ModelDownloadTask` actually ran (a local model with a fetch source). */
    downloaded: Type.Boolean(),
    /** True when a cloud `ModelInfoTask` existence check succeeded. */
    verified: Type.Boolean(),
  });
export type EnsureModelDownloadedOutput = Static<ReturnType<typeof OutputSchema>>;

/**
 * Ensure a model is ready before generation, deriving what to do entirely from
 * the **model id**.
 *
 * `trySecModelRecord` dispatches on the id shape (an `onnx:` id → HuggingFace
 * ONNX, a `llama:` / `node-llama:` / `gguf:` id → node-llama-cpp, an `hfi:` /
 * `open-router:` / `claude-*` / `gpt-*` / `gemini-*` / `grok-*` / `deepseek-*`
 * id → the matching cloud provider — the same dispatch registration uses), so the
 * task figures out the provider without being handed a resolved `ModelConfig`.
 * The non-throwing variant, because an id sec doesn't route may still be a model
 * registered directly in the repository — see the `execute` comment.
 * From the derived record it decides what readiness requires:
 *
 * - cloud API models are verified via `ModelInfoTask` (live provider retrieve /
 *   catalog exact-match — stubs that always succeed are not enough);
 * - HuggingFace ONNX auto-downloads on first generation anyway, so this merely
 *   fetches it ahead of the timed work;
 * - node-llama-cpp (GGUF) loads its `model_path` directly and does **not** fetch
 *   on generation — so a GGUF id configured with a `model_url` (a remote `hf:` /
 *   `https:` URI) only lands on disk if `ModelDownloadTask` runs first, while a
 *   bare local `llama:` / `gguf:` path is assumed already on disk and skipped.
 *
 * Download / verify run as an **owned** subtask (`context.own`), so they are
 * registered in the running task's graph and inherit its registry + abort signal,
 * and `phase` events forward to `context.updateProgress`. Memoized per model id
 * on success, so a per-section sweep pays the cost once.
 */
export class EnsureModelDownloadedTask extends Task<
  EnsureModelDownloadedInput,
  EnsureModelDownloadedOutput
> {
  static readonly type = "EnsureModelDownloadedTask";
  static readonly category = "SEC";
  static readonly title = "Ensure model ready";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }

  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: EnsureModelDownloadedInput,
    context: IExecuteContext
  ): Promise<EnsureModelDownloadedOutput> {
    const modelId = input.model;
    if (!modelId || ensured.has(modelId)) return { downloaded: false, verified: false };

    // Figure out the provider (and its download/verify config) from the id shape alone.
    // An id whose shape sec doesn't route (`undefined`) is not an error here: it
    // belongs to a record registered directly in the model repository by an
    // operator or harness, so it is simply not ours to download/verify — fall into
    // the nothing-to-do branch below rather than failing the caller's extraction.
    const record = trySecModelRecord(modelId);
    const provider = record?.provider;
    if (!record || !provider) {
      ensured.add(modelId);
      return { downloaded: false, verified: false };
    }

    if (VERIFYABLE_PROVIDERS.has(provider)) {
      const infoInput = { model: record };
      const info = context.own(
        new ModelInfoTask({ title: `Verify ${modelId}`, defaults: infoInput } as any)
      );
      await info.run(infoInput as any, {
        updateProgress: (_t, progress, message) => context.updateProgress(progress, message),
        signal: context.signal,
      });
      ensured.add(modelId);
      return { downloaded: false, verified: true };
    }

    if (!DOWNLOADABLE_PROVIDERS.has(provider)) {
      ensured.add(modelId);
      return { downloaded: false, verified: false };
    }

    if (provider === LLAMACPP_PROVIDER) {
      const config = record.provider_config as { model_url?: string } | undefined;
      if (!config?.model_url) {
        // Bare local GGUF path: nothing to fetch. Mark ready so we don't re-check.
        ensured.add(modelId);
        return { downloaded: false, verified: false };
      }
    }

    const downloadInput = { model: record };
    // Own the download on this task's execute context so it is registered in the
    // graph and inherits the registry + abort signal.
    const download = context.own(
      new ModelDownloadTask({ title: `Download ${modelId}`, defaults: downloadInput } as any)
    );
    // Drive the download through its `run()` lifecycle. `run` routes the download
    // run-fn's `phase` events to `config.updateProgress`, which we forward to the
    // caller's `context.updateProgress` so a multi-GB fetch renders a live
    // percentage in the CLI task UI; `signal` aborts it on Ctrl-C.
    await download.run(downloadInput as any, {
      updateProgress: (_t, progress, message) => context.updateProgress(progress, message),
      signal: context.signal,
    });
    ensured.add(modelId);
    return { downloaded: true, verified: false };
  }
}

/**
 * Own and run an {@link EnsureModelDownloadedTask} on the caller's execute context
 * to make `model` ready before generation (download local weights, or verify an
 * API model exists). Throws on a download/verify failure (the caller decides how
 * to record it — a dead-lettered section, a failed eval run). No-op for an empty
 * id or an already-ensured model (the memo short-circuits before a task node is
 * even created). See {@link EnsureModelDownloadedTask}.
 */
export async function ensureModelDownloaded(
  model: string | null | undefined,
  context: IExecuteContext
): Promise<void> {
  if (!model || ensured.has(model)) return;
  const input = { model };
  const task = context.own(
    new EnsureModelDownloadedTask({ title: `Ensure ${model} ready`, defaults: input })
  );
  await task.run(input, {
    updateProgress: (_t, progress, message) => context.updateProgress(progress, message),
    signal: context.signal,
  });
}

/**
 * Best-effort prefetch used at the CLI-task boundary (form processors, eval
 * sweeps) to surface download progress (or an early verify) before the work
 * begins. No-ops when there is no model id or no context (a direct/test caller),
 * and swallows failures — the downstream generation path re-attempts via
 * {@link ensureModelDownloaded} and records the failure in its own way (dead-letter
 * or failed eval run), so a prefetch problem must never abort the run. Whether it
 * downloads with a visible progress bar is decided entirely by whether a real
 * `context` is threaded in.
 */
export async function prefetchModel(
  model: string | null | undefined,
  context: IExecuteContext | undefined
): Promise<void> {
  if (!model || !context) return;
  try {
    await ensureModelDownloaded(model, context);
  } catch {
    // Downstream generation re-attempts the download/verify and records any failure.
  }
}
