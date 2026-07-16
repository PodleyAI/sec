/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isAbsolute, join } from "node:path";
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
const OPENAI_PROVIDER = "OPENAI";
const GEMINI_PROVIDER = "GOOGLE_GEMINI";
const XAI_PROVIDER = "XAI";
const HFT_PROVIDER = "HF_TRANSFORMERS_ONNX";
const LLAMACPP_PROVIDER = "LOCAL_LLAMACPP";

/**
 * Prefix that routes a model id to the node-llama-cpp (GGUF) provider. The rest
 * of the id is either a **local path** to a `.gguf` file — absolute
 * (`gguf:/abs/x.gguf`) or relative to the GGUF models dir
 * (`gguf:Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`) — or a **remote URI** the download
 * harness fetches: a node-llama-cpp HuggingFace URI (`gguf:hf:org/repo:Q4_K_M`)
 * or an `https://` URL. We key on an explicit prefix rather than the id shape
 * because a GGUF repo id (`org/name`) is indistinguishable from an ONNX one.
 */
const GGUF_ID_PREFIX = "gguf:";

/** HuggingFace repo ids are `org/name`; Anthropic ids (`claude-*`) never contain `/`. */
function isHftModelId(modelId: string): boolean {
  return modelId.includes("/");
}

function isLlamaCppModelId(modelId: string): boolean {
  return modelId.startsWith(GGUF_ID_PREFIX);
}

/**
 * OpenAI cloud ids — the GPT chat family (`gpt-5.5`, `gpt-5.5-mini`, `gpt-4o`, …)
 * and the `o`/`chatgpt` reasoning families. Matched before the Anthropic
 * fall-through so a `gpt-*` id routes to the OpenAI provider rather than being
 * sent to Anthropic. NOTE: only non-thinking instruct models produce clean
 * `json-mode` output — the `o`-series reasoning models wrap the JSON in a
 * reasoning preamble (same caveat as the local thinking models).
 */
function isOpenAiModelId(modelId: string): boolean {
  return /^(gpt-|chatgpt-|o[134](-|$))/i.test(modelId);
}

/** Google Gemini cloud ids — `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, … */
function isGeminiModelId(modelId: string): boolean {
  return /^gemini-/i.test(modelId);
}

/** xAI Grok cloud ids — `grok-4.5`, `grok-4.3`, … */
function isXaiModelId(modelId: string): boolean {
  return /^grok-/i.test(modelId);
}

/**
 * Directory holding downloaded `.gguf` weights: `$SEC_GGUF_DIR`, else
 * `$SEC_RAW_DATA_FOLDER/gguf`, else `./models`. A relative `gguf:` id resolves
 * against this; an absolute one is used as-is.
 */
function ggufModelsDir(): string {
  const explicit = process.env.SEC_GGUF_DIR?.trim();
  if (explicit) return explicit;
  const raw = process.env.SEC_RAW_DATA_FOLDER?.trim();
  return raw ? `${raw}/gguf` : "./models";
}

/**
 * Context window for the local GGUF extractors. Defaults to 8192 tokens, which
 * loads on memory-constrained hosts: a 32k KV cache for a dense 12–14B model
 * exceeds the Metal working-set budget even on a 64 GB machine, so the context
 * fails to allocate. 8k fits every tested local model and covers typical
 * sections. Large real S-1 sections reach ~57k chars (~19k tokens) — raise
 * `SEC_GGUF_CONTEXT` (e.g. 32768) when extracting those with a model whose
 * weights leave room for the bigger KV cache (the provider now evicts other
 * cached models on a VRAM error to help it fit).
 */
function ggufContextSize(): number {
  const n = Number(process.env.SEC_GGUF_CONTEXT?.trim());
  return Number.isFinite(n) && n > 0 ? n : 8192;
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
 * Full capability set for an OpenAI chat model. Mirrors the Anthropic set: the
 * OpenAI provider serves `json-mode` via native `response_format` json-schema,
 * but — as for Anthropic — we declare `json-mode` / `text.generation` explicitly
 * rather than rely on the installed provider's id-based capability inference,
 * which doesn't recognize newer ids like `gpt-5.5` and would trip
 * `StructuredGenerationTask`'s capability gate.
 */
const OPENAI_CAPABILITIES: readonly string[] = [
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
 * Builds a fully-specified OpenAI {@link ModelRecord}. `provider_config.model_name`
 * is the OpenAI model identifier passed straight to the API; the shape mirrors
 * the Anthropic record so the two cloud providers are interchangeable in the
 * `sec eval` harness.
 */
export function openAiModelRecord(modelId: string): ModelRecord {
  return {
    model_id: modelId,
    provider: OPENAI_PROVIDER,
    title: modelId,
    description: `OpenAI ${modelId}`,
    capabilities: [...OPENAI_CAPABILITIES],
    provider_config: { model_name: modelId, max_tokens: DEFAULT_MAX_TOKENS },
    metadata: {},
  };
}

/**
 * Full capability set for a Google Gemini / xAI Grok chat model. Same rationale
 * as the Anthropic/OpenAI sets — declare `json-mode` / `text.generation`
 * explicitly rather than rely on the installed provider's id-based capability
 * inference (which doesn't recognize newer ids like `gemini-3.1-pro-preview` or
 * `grok-4.5`) so `StructuredGenerationTask`'s gate passes. Gemini serves
 * `json-mode` via `responseSchema`; Grok via native json-schema output.
 */
const CLOUD_CHAT_CAPABILITIES: readonly string[] = [
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

/** Builds a fully-specified Google Gemini {@link ModelRecord} (`provider: "GOOGLE_GEMINI"`). */
export function geminiModelRecord(modelId: string): ModelRecord {
  return {
    model_id: modelId,
    provider: GEMINI_PROVIDER,
    title: modelId,
    description: `Google Gemini ${modelId}`,
    capabilities: [...CLOUD_CHAT_CAPABILITIES],
    provider_config: { model_name: modelId, max_tokens: DEFAULT_MAX_TOKENS },
    metadata: {},
  };
}

/** Builds a fully-specified xAI Grok {@link ModelRecord} (`provider: "XAI"`). */
export function xaiModelRecord(modelId: string): ModelRecord {
  return {
    model_id: modelId,
    provider: XAI_PROVIDER,
    title: modelId,
    description: `xAI Grok ${modelId}`,
    capabilities: [...CLOUD_CHAT_CAPABILITIES],
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
 * Full capability set for a local node-llama-cpp (GGUF) text-generation model.
 * As for the other local provider we declare `json-mode` explicitly — but here
 * it is served by a **grammar-constrained** run function, so structured output
 * stays schema-valid even for thinking models (the grammar forbids a reasoning
 * preamble). `StructuredGenerationTask`'s capability gate needs `json-mode` and
 * `text.generation` present.
 */
const LLAMACPP_CAPABILITIES: readonly string[] = [
  "text.generation",
  "json-mode",
  "tool-use",
  "model.count-tokens",
  "model.download",
  "model.download-remove",
  "model.info",
  "model.search",
];

/**
 * Builds a node-llama-cpp {@link ModelRecord} from a `gguf:`-prefixed id. The
 * remainder is either a **local path** to a `.gguf` file (absolute, or relative
 * to {@link ggufModelsDir}) or a **remote URI** (`hf:org/repo:quant` or an
 * `https://` URL) that carries a `model_url` for the download harness to fetch —
 * see {@link ggufPathConfig}. `gpu_layers` is set high (offload every layer to the
 * GPU — Metal on Apple Silicon; node-llama-cpp clamps to the model's layer
 * count). Do NOT use `-1`: that is llama.cpp's "all" sentinel but node-llama-cpp
 * treats it as zero, silently running the whole model on CPU (~20x slower).
 * `context_size` is sized for large S-1 sections. A bare local path must already
 * exist on disk — the provider loads `model_path` directly and does not fetch at
 * generation; the download harness (`ensureModelDownloaded`) fetches a `model_url`
 * ahead of use.
 */
const GGUF_GPU_LAYERS_ALL = 999;

/** A `gguf:` remainder that names a remote source the download harness can fetch. */
function isRemoteGgufUri(rawPath: string): boolean {
  return rawPath.startsWith("hf:") || /^https?:\/\//i.test(rawPath);
}

/**
 * Local `.gguf` filename to cache a remote GGUF under, derived from its URI. This
 * is only a fallback for the required `model_path` field: once the download runs,
 * the provider keys on `model_url` and resolves the real on-disk path itself, so
 * the exact name here does not affect which file generation loads — it just gives
 * the cache target a stable, human-legible name.
 *
 * `hf:org/repo:Q4_K_M` → `repo-Q4_K_M.gguf`; `hf:org/repo/file.gguf` → `file.gguf`;
 * `https://host/a/b/model.gguf` → `model.gguf`.
 */
function ggufCacheFileName(uri: string): string {
  let rest = uri.replace(/^https?:\/\//i, "").replace(/^hf:/i, "");
  // A trailing `:quant` (HF quant selector) is a filename hint, not a path segment.
  let quant: string | undefined;
  const quantMatch = rest.match(/:([^/:]+)$/);
  if (quantMatch) {
    quant = quantMatch[1];
    rest = rest.slice(0, rest.length - quant.length - 1);
  }
  const last = rest.split(/[/?#]/).filter(Boolean).pop() ?? "model";
  const base = last.toLowerCase().endsWith(".gguf") ? last.slice(0, -".gguf".length) : last;
  const name = [base, quant].filter(Boolean).join("-") || "model";
  return `${name}.gguf`;
}

/**
 * Resolves a `gguf:` id remainder into node-llama-cpp path config. A remote URI
 * ({@link isRemoteGgufUri}) becomes `model_url` (the download source) plus a local
 * `model_path` / `models_dir` under {@link ggufModelsDir} so the harness fetches
 * it there; a plain path stays `model_path`-only (assumed already on disk).
 */
function ggufPathConfig(rawPath: string): Record<string, unknown> {
  if (!isRemoteGgufUri(rawPath)) {
    return { model_path: isAbsolute(rawPath) ? rawPath : join(ggufModelsDir(), rawPath) };
  }
  const dir = ggufModelsDir();
  return {
    model_path: join(dir, ggufCacheFileName(rawPath)),
    model_url: rawPath,
    models_dir: dir,
  };
}

export function llamaCppModelRecord(modelId: string): ModelRecord {
  const rawPath = modelId.slice(GGUF_ID_PREFIX.length);
  return {
    model_id: modelId,
    provider: LLAMACPP_PROVIDER,
    title: modelId,
    description: `node-llama-cpp GGUF ${rawPath}`,
    capabilities: [...LLAMACPP_CAPABILITIES],
    provider_config: {
      ...ggufPathConfig(rawPath),
      gpu_layers: GGUF_GPU_LAYERS_ALL,
      context_size: ggufContextSize(),
      flash_attention: true,
    },
    metadata: {},
  };
}

/**
 * Builds a provider-appropriate {@link ModelRecord} for a model id, dispatching
 * on id shape: a `gguf:` id → node-llama-cpp (local GGUF), a HuggingFace
 * `org/name` id → HFT ONNX (local), a `gpt-*`/`o*` id → OpenAI, a `gemini-*` id
 * → Google Gemini, a `grok-*` id → xAI, otherwise Anthropic (all cloud). Shared
 * by {@link registerSecModels} and the `sec eval` harness so both mint identical
 * records for the same id.
 */
export function secModelRecord(modelId: string): ModelRecord {
  if (isLlamaCppModelId(modelId)) return llamaCppModelRecord(modelId);
  if (isHftModelId(modelId)) return hftModelRecord(modelId);
  if (isOpenAiModelId(modelId)) return openAiModelRecord(modelId);
  if (isGeminiModelId(modelId)) return geminiModelRecord(modelId);
  if (isXaiModelId(modelId)) return xaiModelRecord(modelId);
  return anthropicModelRecord(modelId);
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
  for (const key of [
    "SEC_S1_MODEL",
    "SEC_S1_CLASSIFIER_MODEL",
    "SEC_MERGER_PROXY_MODEL",
    "SEC_REDEMPTION_MODEL",
    "SEC_LOI_MODEL",
  ]) {
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
