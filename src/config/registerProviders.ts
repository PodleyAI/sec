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
 * - **OpenAI** (`provider: "OPENAI"`) — inline; the cloud path for the GPT family
 *   (`gpt-5.5`, `gpt-5.4-mini`, …) in the `sec eval` model comparison. Needs
 *   `OPENAI_API_KEY` at run time.
 * - **Google Gemini** (`provider: "GOOGLE_GEMINI"`) — inline; the `gemini-*`
 *   family (`gemini-3.1-pro-preview`, `gemini-3-flash-preview`, …). Needs
 *   `GEMINI_API_KEY` at run time.
 * - **xAI Grok** (`provider: "XAI"`) — inline; the `grok-*` family (`grok-4.6`,
 *   …). Needs `XAI_API_KEY` at run time.
 * - **DeepSeek** (`provider: "DEEPSEEK"`) — inline; the `deepseek-*` family
 *   (`deepseek-v4-flash`, `deepseek-v4-pro`). Needs `DEEPSEEK_API_KEY` at run
 *   time.
 * - **HuggingFace Transformers ONNX** (`provider: "HF_TRANSFORMERS_ONNX"`) —
 *   **worker-backed, not inline**: the heavy `@huggingface/transformers` graph
 *   runs in a spawned worker (`hftWorker.ts`), never on the main thread. Lets us
 *   run a local model and compare it against the cloud path.
 * - **node-llama-cpp GGUF** (`provider: "LOCAL_LLAMACPP"`) — **worker-backed**:
 *   the native llama.cpp binding (Metal on Apple Silicon) runs in a spawned
 *   worker (`llamaCppWorker.ts`). This is the local path for larger GGUF models,
 *   and its `json-mode` is **grammar-constrained**, so structured extraction
 *   stays schema-valid (and thinking models can't leak a reasoning preamble).
 * - **HuggingFace Inference** (`provider: "HF_INFERENCE"`) — inline; the cloud
 *   Inference API for `hfi:[provider:]org/name` ids. Needs `HF_TOKEN` at run time.
 * - **OpenRouter** (`provider: "OPENROUTER"`) — inline; the OpenRouter gateway
 *   for `open-router:[provider:]vendor/model` ids. Needs `OPENROUTER_API_KEY` at
 *   run time.
 *
 * Each provider is registered independently and defensively: a failure to load
 * one (missing optional dependency, worker spawn error) is logged and skipped so
 * it never aborts the CLI or the other providers. Registration is idempotent
 * enough for repeat bootstraps — the provider registry keeps the last registrant.
 */
export async function registerSecProviders(): Promise<void> {
  // Local always: it is what makes `sec ask` work on a machine with no keys.
  await registerHft();
  // Cloud only where a key is present. A provider registered without one
  // advertises models that cannot run, and the failure surfaces later inside a
  // task as an authentication error rather than here as configuration.
  if (process.env.ANTHROPIC_API_KEY?.trim()) await registerAnthropic();
  if (process.env.OPENAI_API_KEY?.trim()) await registerOpenAi();
  if (process.env.GEMINI_API_KEY?.trim()) await registerGemini();
}

async function registerAnthropic(): Promise<void> {
  try {
    const { registerAnthropicInline } = await import("workglow/anthropic/runtime");
    await registerAnthropicInline();
  } catch (err) {
    warn("Anthropic", err);
  }
}

async function registerOpenAi(): Promise<void> {
  try {
    const { registerOpenAiInline } = await import("workglow/openai/runtime");
    await registerOpenAiInline();
  } catch (err) {
    warn("OpenAI", err);
  }
}

async function registerGemini(): Promise<void> {
  try {
    const { registerGeminiInline } = await import("workglow/gemini/runtime");
    await registerGeminiInline();
  } catch (err) {
    warn("Google Gemini", err);
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

function warn(provider: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`AI provider "${provider}" not registered: ${msg}`);
}
