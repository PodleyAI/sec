/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isAbsolute, join } from "node:path";
import type { ModelRecord, ServiceRegistry } from "workglow";
import { getGlobalModelRepository, globalServiceRegistry } from "workglow";
import { SecHftModelDefault, SecModelDefault } from "./Constants";
import { SecCliConfigurationError } from "./EnvToDI";
import { listPricingForModelId } from "./listPricing";

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
const DEEPSEEK_PROVIDER = "DEEPSEEK";
const HFT_PROVIDER = "HF_TRANSFORMERS_ONNX";
const LLAMACPP_PROVIDER = "LOCAL_LLAMACPP";
const HFI_PROVIDER = "HF_INFERENCE";
const OPENROUTER_PROVIDER = "OPENROUTER";

/**
 * Explicit id prefixes. Several providers use `org/name` (or vendor/model) paths,
 * so a bare `/` is not enough to pick a backend — the prefix is the discriminator.
 * The remainder after the prefix is what the provider's `provider_config` wants
 * (HF repo id, GGUF path/URI, OpenRouter model id, …).
 */
const ONNX_ID_PREFIX = "onnx:";
const HFI_ID_PREFIX = "hfi:";
const OPEN_ROUTER_ID_PREFIX = "open-router:";
/**
 * Prefixes that route to node-llama-cpp. `gguf:` is kept as a legacy alias of
 * `llama:` / `node-llama:` so existing eval commands and docs keep working.
 * Longer prefixes are listed first so a future overlapping short form cannot
 * steal a match.
 */
const LLAMACPP_ID_PREFIXES = ["node-llama:", "llama:", "gguf:"] as const;

function matchIdPrefix(modelId: string, prefixes: readonly string[]): string | undefined {
  for (const prefix of prefixes) {
    if (modelId.startsWith(prefix)) return prefix;
  }
  return undefined;
}

function isHftModelId(modelId: string): boolean {
  return modelId.startsWith(ONNX_ID_PREFIX);
}

function isHfInferenceModelId(modelId: string): boolean {
  return modelId.startsWith(HFI_ID_PREFIX);
}

function isOpenRouterModelId(modelId: string): boolean {
  return modelId.startsWith(OPEN_ROUTER_ID_PREFIX);
}

/**
 * After an `hfi:` / `open-router:` prefix strip, an optional inference-provider
 * segment may precede the model id (`PROVIDER:vendor/model`). Empty left or
 * right after a colon is a config error.
 *
 * The separator is the first `:` only when it comes BEFORE the first `/`. An
 * OpenRouter id carries its own colon-suffixed variants
 * (`anthropic/claude-sonnet-4:thinking`, `…:free`, `…:nitro`), so splitting on
 * the first colon unconditionally read `anthropic/claude-sonnet-4` as a routing
 * provider and `thinking` as the whole model name — a request pinned to a
 * non-existent provider for a non-existent model. A colon after the slash is
 * part of the model id and stays there.
 */
function splitOptionalInferenceProvider(remainder: string): {
  readonly inferenceProvider: string | undefined;
  readonly modelName: string;
} {
  const colon = remainder.indexOf(":");
  const slash = remainder.indexOf("/");
  if (colon < 0 || (slash >= 0 && colon > slash)) {
    return { inferenceProvider: undefined, modelName: remainder };
  }
  const inferenceProvider = remainder.slice(0, colon);
  const modelName = remainder.slice(colon + 1);
  if (!inferenceProvider || !modelName) {
    throw new SecCliConfigurationError(
      `Invalid gated model id remainder "${remainder}" — expected ` +
        `"[provider:]model" with non-empty provider and model segments.`
    );
  }
  return { inferenceProvider, modelName };
}

function llamaCppIdPrefix(modelId: string): string | undefined {
  return matchIdPrefix(modelId, LLAMACPP_ID_PREFIXES);
}

function isLlamaCppModelId(modelId: string): boolean {
  return llamaCppIdPrefix(modelId) !== undefined;
}

/** Anthropic cloud ids — the Claude family (`claude-sonnet-5`, `claude-opus-5`, …). */
function isAnthropicModelId(modelId: string): boolean {
  return /^claude-/i.test(modelId);
}

/**
 * OpenAI cloud ids — the GPT chat family (`gpt-5.5`, `gpt-5.5-mini`, `gpt-4o`, …)
 * and the `o`/`chatgpt` reasoning families. NOTE: only non-thinking instruct
 * models produce clean `json-mode` output — the `o`-series reasoning models wrap
 * the JSON in a reasoning preamble (same caveat as the local thinking models).
 */
function isOpenAiModelId(modelId: string): boolean {
  return /^(gpt-|chatgpt-|o[134](-|$))/i.test(modelId);
}

/** Google Gemini cloud ids — `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, … */
function isGeminiModelId(modelId: string): boolean {
  return /^gemini-/i.test(modelId);
}

/** xAI Grok cloud ids — `grok-4.6`, `grok-4.5`, … */
function isXaiModelId(modelId: string): boolean {
  return /^grok-/i.test(modelId);
}

/**
 * DeepSeek cloud ids — `deepseek-v4-flash`, `deepseek-v4-pro`, …. A HuggingFace
 * repo under the `deepseek-ai` org must use an explicit local prefix
 * (`onnx:deepseek-ai/…` or `hfi:deepseek-ai/…`); a bare `deepseek-*` id is always
 * the cloud API.
 */
function isDeepSeekModelId(modelId: string): boolean {
  return /^deepseek-/i.test(modelId);
}

/**
 * Directory holding downloaded `.gguf` weights: `$SEC_GGUF_DIR`, else
 * `$SEC_RAW_DATA_FOLDER/gguf`, else `./models`. A relative llama-cpp id
 * (`llama:…` / `node-llama:…` / `gguf:…`) resolves against this; an absolute
 * one is used as-is.
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
const DEFAULT_MAX_TOKENS = 8192 * 2;

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
    pricing: listPricingForModelId(modelId),
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
/**
 * Reasoning effort for OpenAI calls, from `SEC_OPENAI_REASONING_EFFORT`.
 *
 * Unset by default — deliberately expressing NO preference, which lets the
 * provider decide. That matters because the two knobs are coupled on the
 * reasoning families: `gpt-5.6-luna` rejects `temperature` outright while
 * reasoning is on, so the provider turns reasoning off for any request that
 * pins a temperature (see `finalizeResponsesRequest`). Extraction pins
 * temperature 0, so it gets reasoning-off and reproducible sampling without
 * naming either here.
 *
 * Set to `low` / `medium` / `high` to state a preference explicitly, which the
 * provider then honours over its own default. The enum is per-model —
 * `minimal` is valid on some ids and rejected by `gpt-5.6-luna` — so an
 * unsupported value fails loudly rather than degrading.
 */
export function getOpenAiReasoningEffort(): string | undefined {
  const raw = process.env.SEC_OPENAI_REASONING_EFFORT;
  return raw === undefined || raw.trim() === "" ? undefined : raw.trim();
}

export function openAiModelRecord(modelId: string): ModelRecord {
  const effort = getOpenAiReasoningEffort();
  return {
    model_id: modelId,
    provider: OPENAI_PROVIDER,
    title: modelId,
    description: `OpenAI ${modelId}`,
    capabilities: [...OPENAI_CAPABILITIES],
    provider_config: {
      model_name: modelId,
      max_tokens: DEFAULT_MAX_TOKENS,
      ...(effort === undefined ? {} : { reasoning: { effort } }),
    },
    metadata: {},
    pricing: listPricingForModelId(modelId),
  };
}

/**
 * Full capability set for a Google Gemini / xAI Grok / DeepSeek chat model. Same
 * rationale as the Anthropic/OpenAI sets — declare `json-mode` /
 * `text.generation` explicitly rather than rely on the installed provider's
 * id-based capability inference (which doesn't recognize newer ids like
 * `gemini-3.1-pro-preview`, `grok-4.5`, or `deepseek-v4-pro`) so
 * `StructuredGenerationTask`'s gate passes. Gemini serves `json-mode` via
 * `responseSchema` and Grok via native json-schema output; DeepSeek accepts only
 * `response_format: {type: "json_object"}`, so its provider passes the schema in
 * the prompt and the shape is *not* enforced server-side — expect a higher
 * schema-failure rate there (the task re-validates, so a bad shape still fails
 * loudly rather than persisting).
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
    pricing: listPricingForModelId(modelId),
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
    pricing: listPricingForModelId(modelId),
  };
}

/**
 * Builds a fully-specified DeepSeek {@link ModelRecord} (`provider: "DEEPSEEK"`).
 * The v4 models are text-only, so the shared cloud-chat set's `vision-input` tag
 * is dropped — nothing in the extraction path requests it, and claiming it would
 * let a vision task resolve to a model that cannot serve it.
 */
export function deepSeekModelRecord(modelId: string): ModelRecord {
  return {
    model_id: modelId,
    provider: DEEPSEEK_PROVIDER,
    title: modelId,
    description: `DeepSeek ${modelId}`,
    capabilities: CLOUD_CHAT_CAPABILITIES.filter((c) => c !== "vision-input"),
    provider_config: { model_name: modelId, max_tokens: DEFAULT_MAX_TOKENS },
    metadata: {},
    pricing: listPricingForModelId(modelId),
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
 * Builds a fully-specified HuggingFace Transformers (ONNX) {@link ModelRecord}
 * from an `onnx:`-prefixed id. `provider_config.model_path` is the HuggingFace
 * repo id after the prefix (`onnx:org/name` → `org/name`), loaded on first use
 * into the worker; `pipeline: "text-generation"` selects the causal-LM pipeline
 * the structured-generation path drives.
 */
export function hftModelRecord(modelId: string): ModelRecord {
  const modelPath = modelId.startsWith(ONNX_ID_PREFIX)
    ? modelId.slice(ONNX_ID_PREFIX.length)
    : modelId;
  return {
    model_id: modelId,
    provider: HFT_PROVIDER,
    title: modelId,
    description: `HuggingFace Transformers ONNX ${modelPath}`,
    capabilities: [...HFT_CAPABILITIES],
    provider_config: {
      model_path: modelPath,
      pipeline: "text-generation",
      device: "webgpu",
      dtype: "q4f16",
    },
    metadata: {},
    pricing: listPricingForModelId(modelId),
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
 * Builds a node-llama-cpp {@link ModelRecord} from a `llama:` / `node-llama:` /
 * `gguf:`-prefixed id. The remainder is either a **local path** to a `.gguf`
 * file (absolute, or relative to {@link ggufModelsDir}) or a **remote URI**
 * (`hf:org/repo:quant` or an `https://` URL) that carries a `model_url` for the
 * download harness to fetch — see {@link ggufPathConfig}. `gpu_layers` is set
 * high (offload every layer to the GPU — Metal on Apple Silicon; node-llama-cpp
 * clamps to the model's layer count). Do NOT use `-1`: that is llama.cpp's "all"
 * sentinel but node-llama-cpp treats it as zero, silently running the whole
 * model on CPU (~20x slower). `context_size` is sized for large S-1 sections. A
 * bare local path must already exist on disk — the provider loads `model_path`
 * directly and does not fetch at generation; the download harness
 * (`ensureModelDownloaded`) fetches a `model_url` ahead of use.
 */
const GGUF_GPU_LAYERS_ALL = 999;

/** A llama-cpp id remainder that names a remote source the download harness can fetch. */
function isRemoteGgufUri(rawPath: string): boolean {
  return /^hf:/i.test(rawPath) || /^https?:\/\//i.test(rawPath);
}

/**
 * Local `.gguf` filename to cache a remote GGUF under, derived from its URI. This
 * is only a fallback for the required `model_path` field: once the download runs,
 * the provider keys on `model_url` and resolves the real on-disk path itself, so
 * the exact name here does not affect which file generation loads — it just gives
 * the cache target a stable, human-legible name. The whole path (not just the last
 * segment) is folded into the name so distinct sources don't collide on disk
 * (`hf:org1/repo:Q4` vs `hf:org2/repo:Q4`; two repos each holding `model.gguf`).
 *
 * `hf:org/repo:Q4_K_M` → `org-repo-Q4_K_M.gguf`;
 * `hf:org/repo/file.gguf` → `org-repo-file.gguf`;
 * `https://host/a/b/model.gguf` → `host-a-b-model.gguf`.
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
  const stripped = rest.replace(/\.gguf$/i, "");
  // Fold every path/query separator (and any other unsafe char) into `-` so the
  // full source path is preserved as one filesystem-safe slug.
  const slug = stripped.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const name = [slug || "model", quant].filter(Boolean).join("-");
  return `${name}.gguf`;
}

/**
 * Resolves a llama-cpp id remainder into node-llama-cpp path config. A remote URI
 * ({@link isRemoteGgufUri}) becomes `model_url` (the download source) plus a local
 * `model_path` / `models_dir` under {@link ggufModelsDir} so the harness fetches
 * it there; a plain path stays `model_path`-only (assumed already on disk).
 */
function ggufPathConfig(rawPath: string, idPrefix: string): Record<string, unknown> {
  if (!isRemoteGgufUri(rawPath)) {
    const resolved = isAbsolute(rawPath) ? rawPath : join(ggufModelsDir(), rawPath);
    // A llama-cpp id must point at a `.gguf` weights file. Absent the guard, a
    // typo (or the id shape as a whole) can silently coerce node-llama-cpp
    // into loading an arbitrary file off disk — the provider takes what the
    // record's `model_path` says. The remote-URI branch stays unchecked: the
    // download harness always caches under a synthesized `.gguf` filename.
    if (!/\.gguf$/i.test(resolved)) {
      throw new SecCliConfigurationError(
        `${idPrefix}${rawPath} must resolve to a .gguf file (got ${resolved})`
      );
    }
    return { model_path: resolved };
  }
  const dir = ggufModelsDir();
  return {
    model_path: join(dir, ggufCacheFileName(rawPath)),
    model_url: rawPath,
    models_dir: dir,
  };
}

export function llamaCppModelRecord(modelId: string): ModelRecord {
  const prefix = llamaCppIdPrefix(modelId) ?? "gguf:";
  const rawPath = modelId.slice(prefix.length);
  return {
    model_id: modelId,
    provider: LLAMACPP_PROVIDER,
    title: modelId,
    description: `node-llama-cpp GGUF ${rawPath}`,
    capabilities: [...LLAMACPP_CAPABILITIES],
    provider_config: {
      ...ggufPathConfig(rawPath, prefix),
      gpu_layers: GGUF_GPU_LAYERS_ALL,
      context_size: ggufContextSize(),
      flash_attention: true,
    },
    metadata: {},
    pricing: listPricingForModelId(modelId),
  };
}

/**
 * Builds a HuggingFace Inference API {@link ModelRecord} from an `hfi:`-prefixed
 * id. The remainder is the HF repo id (`hfi:meta-llama/…` → `model_name`), or
 * `hfi:PROVIDER:org/name` to pin the HF Inference router host onto
 * `provider_config.provider`. Needs `HF_TOKEN` at run time.
 */
export function hfInferenceModelRecord(modelId: string): ModelRecord {
  const remainder = modelId.startsWith(HFI_ID_PREFIX)
    ? modelId.slice(HFI_ID_PREFIX.length)
    : modelId;
  const { inferenceProvider, modelName } = splitOptionalInferenceProvider(remainder);
  return {
    model_id: modelId,
    provider: HFI_PROVIDER,
    title: modelId,
    description: `HuggingFace Inference ${modelName}`,
    capabilities: [...CLOUD_CHAT_CAPABILITIES],
    provider_config: {
      model_name: modelName,
      ...(inferenceProvider ? { provider: inferenceProvider } : {}),
    },
    metadata: {},
    pricing: listPricingForModelId(modelId),
  };
}

/**
 * Builds an OpenRouter {@link ModelRecord} from an `open-router:`-prefixed id.
 * The remainder is the OpenRouter model id (`open-router:anthropic/claude-sonnet-4`
 * → `model_name`), or `open-router:PROVIDER:vendor/model` to hard-pin routing via
 * `provider_config.provider_routing` (`only` + no fallbacks). Needs
 * `OPENROUTER_API_KEY` at run time.
 */
export function openRouterModelRecord(modelId: string): ModelRecord {
  const remainder = modelId.startsWith(OPEN_ROUTER_ID_PREFIX)
    ? modelId.slice(OPEN_ROUTER_ID_PREFIX.length)
    : modelId;
  const { inferenceProvider, modelName } = splitOptionalInferenceProvider(remainder);
  return {
    model_id: modelId,
    provider: OPENROUTER_PROVIDER,
    title: modelId,
    description: `OpenRouter ${modelName}`,
    capabilities: [...CLOUD_CHAT_CAPABILITIES],
    provider_config: {
      model_name: modelName,
      ...(inferenceProvider
        ? { provider_routing: { only: [inferenceProvider], allow_fallbacks: false } }
        : {}),
    },
    metadata: {},
    pricing: listPricingForModelId(modelId),
  };
}

/**
 * Provider prefixes recognized by {@link secModelRecord}, in the message shown
 * when an id matches none of them. Kept next to the dispatch below so the two
 * can't drift.
 */
export const KNOWN_MODEL_ID_SHAPES =
  "claude-* (Anthropic), gpt-*/chatgpt-*/o1-*/o3-*/o4-* (OpenAI), " +
  "gemini-* (Google), grok-* (xAI), deepseek-* (DeepSeek), " +
  "onnx:org/name (local HuggingFace ONNX), " +
  "llama:… / node-llama:… / gguf:… (local node-llama-cpp), " +
  "hfi:[provider:]org/name (HuggingFace Inference), " +
  "open-router:[provider:]vendor/model (OpenRouter)";

/**
 * {@link secModelRecord} without the unknown-id throw: `undefined` when no
 * provider claims the id's shape. For callers that merely *inspect* a model id
 * they did not mint — chiefly `EnsureModelDownloadedTask`, which asks "does this
 * need weights fetched?" about ids that may have been registered directly in the
 * model repository by an operator, a harness, or a test. Such an id is legal and
 * simply isn't ours to route, so those callers must not treat it as a failure.
 */
export function trySecModelRecord(modelId: string): ModelRecord | undefined {
  if (isLlamaCppModelId(modelId)) return llamaCppModelRecord(modelId);
  if (isHftModelId(modelId)) return hftModelRecord(modelId);
  if (isHfInferenceModelId(modelId)) return hfInferenceModelRecord(modelId);
  if (isOpenRouterModelId(modelId)) return openRouterModelRecord(modelId);
  if (isAnthropicModelId(modelId)) return anthropicModelRecord(modelId);
  if (isOpenAiModelId(modelId)) return openAiModelRecord(modelId);
  if (isGeminiModelId(modelId)) return geminiModelRecord(modelId);
  if (isXaiModelId(modelId)) return xaiModelRecord(modelId);
  if (isDeepSeekModelId(modelId)) return deepSeekModelRecord(modelId);
  return undefined;
}

/**
 * The API-key environment variable a model id's provider needs, or `undefined`
 * for a local provider (GGUF / HFT ONNX) and for an id whose shape matches no
 * known provider.
 *
 * Dispatches on the same id shapes as {@link trySecModelRecord} — a caller that
 * wants to know "can this id actually run here?" before spending a sweep on it
 * would otherwise have to duplicate that table and let the two drift.
 */
export function modelApiKeyEnvVar(modelId: string): string | undefined {
  if (isLlamaCppModelId(modelId) || isHftModelId(modelId)) return undefined;
  if (isHfInferenceModelId(modelId)) return "HF_TOKEN";
  if (isOpenRouterModelId(modelId)) return "OPENROUTER_API_KEY";
  if (isAnthropicModelId(modelId)) return "ANTHROPIC_API_KEY";
  if (isOpenAiModelId(modelId)) return "OPENAI_API_KEY";
  if (isGeminiModelId(modelId)) return "GEMINI_API_KEY";
  if (isXaiModelId(modelId)) return "XAI_API_KEY";
  if (isDeepSeekModelId(modelId)) return "DEEPSEEK_API_KEY";
  return undefined;
}

/**
 * Builds a provider-appropriate {@link ModelRecord} for a model id, dispatching
 * on an explicit prefix (or a cloud-vendor name pattern): `onnx:` → HFT ONNX,
 * `llama:` / `node-llama:` / `gguf:` → node-llama-cpp, `hfi:` → HuggingFace
 * Inference, `open-router:` → OpenRouter, `claude-*` → Anthropic, `gpt-*`/`o*`
 * → OpenAI, `gemini-*` → Gemini, `grok-*` → xAI, `deepseek-*` → DeepSeek.
 * Shared by {@link registerSecModels} and the `sec eval` harness so both mint
 * identical records for the same id.
 *
 * An id matching no known shape is a hard error rather than a fall-through to
 * one provider. This used to default to Anthropic, which turned every typo and
 * every id from a provider sec doesn't wire up into a record that *looked*
 * valid: dispatch succeeded, the model registered, and the failure surfaced far
 * downstream as a bare `404 model: <id>` from the Anthropic API — naming the
 * wrong provider and burying the real cause. Failing here instead names the id
 * and the shapes that would have worked, before any request goes out.
 *
 * Only for the mint-a-record path. Callers inspecting an id they did not mint
 * want {@link trySecModelRecord}, which returns `undefined` instead.
 */
export function secModelRecord(modelId: string): ModelRecord {
  const record = trySecModelRecord(modelId);
  if (record) return record;
  // A bare `org/name` used to route to the local ONNX provider and now needs an
  // explicit prefix. Without this hint the message lists every legal shape and
  // leaves the operator to notice that one of them is their id plus five
  // characters — the single most likely reason a previously working
  // `SEC_HFT_MODEL` / `--models` value stopped resolving.
  const hint = modelId.includes("/")
    ? ` A bare "org/name" id no longer routes anywhere: prefix it with the provider you mean — ` +
      `"${ONNX_ID_PREFIX}${modelId}" (local ONNX), "${HFI_ID_PREFIX}${modelId}" ` +
      `(HuggingFace Inference), or "${OPEN_ROUTER_ID_PREFIX}${modelId}" (OpenRouter).`
    : "";
  throw new SecCliConfigurationError(
    `Unknown model id "${modelId}" — no provider matches its shape. Expected one of: ${KNOWN_MODEL_ID_SHAPES}.${hint}`
  );
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
    "SEC_S1_RISK_FACTORS_MODEL",
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
