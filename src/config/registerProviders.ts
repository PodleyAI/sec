/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Registers the AI providers the SEC extractors can run against, so a model's
 * `provider` discriminator resolves to something executable:
 *
 * - **Anthropic** (`provider: "ANTHROPIC"`) — inline; the cloud path used by the
 *   default `claude-sonnet-5` model. Cheap to register (the SDK loads lazily on
 *   first call) and needs `ANTHROPIC_API_KEY` at run time.
 * - **HuggingFace Transformers ONNX** (`provider: "HF_TRANSFORMERS_ONNX"`) —
 *   **worker-backed, not inline**: the heavy `@huggingface/transformers` graph
 *   runs in a spawned worker (`hftWorker.ts`), never on the main thread. Lets us
 *   run a local model and compare it against the cloud path.
 * - **node-llama-cpp GGUF** (`provider: "LOCAL_LLAMACPP"`) — **worker-backed**:
 *   the native llama.cpp binding (Metal on Apple Silicon) runs in a spawned
 *   worker (`llamaCppWorker.ts`). This is the local path for larger GGUF models,
 *   and its `json-mode` is **grammar-constrained**, so structured extraction
 *   stays schema-valid (and thinking models can't leak a reasoning preamble).
 *
 * Each provider is registered independently and defensively: a failure to load
 * one (missing optional dependency, worker spawn error) is logged and skipped so
 * it never aborts the CLI or the other providers. Registration is idempotent
 * enough for repeat bootstraps — the provider registry keeps the last registrant.
 */
export async function registerSecProviders(): Promise<void> {
  await registerAnthropic();
  await registerHft();
  await registerLlamaCpp();
}

async function registerAnthropic(): Promise<void> {
  try {
    const { registerAnthropicInline } = await import("workglow/anthropic/runtime");
    await registerAnthropicInline();
  } catch (err) {
    warn("Anthropic", err);
  }
}

async function registerHft(): Promise<void> {
  try {
    // Give the worker a stable on-disk model cache when a raw-data folder is
    // configured, so downloaded ONNX weights survive across CLI invocations.
    if (!process.env.WORKGLOW_MODEL_CACHE && process.env.SEC_RAW_DATA_FOLDER) {
      process.env.WORKGLOW_MODEL_CACHE = `${process.env.SEC_RAW_DATA_FOLDER}/onnx-cache`;
    }
    const { registerHuggingFaceTransformers } = await import("workglow/hf-transformers");
    await registerHuggingFaceTransformers({
      worker: () => new Worker(new URL("./hftWorker.ts", import.meta.url), { type: "module" }),
    });
  } catch (err) {
    warn("HuggingFace Transformers", err);
  }
}

async function registerLlamaCpp(): Promise<void> {
  try {
    const { registerLlamaCpp: register } = await import("@workglow/node-llama-cpp/ai");
    await register({
      worker: () =>
        new Worker(new URL("./llamaCppWorker.ts", import.meta.url), { type: "module" }),
    });
  } catch (err) {
    warn("node-llama-cpp", err);
  }
}

function warn(provider: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`AI provider "${provider}" not registered: ${msg}`);
}
