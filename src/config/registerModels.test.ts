/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelRepository } from "workglow";
import {
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "workglow";
import { DEFAULT_SEC_MODEL, SecHftModelDefault, SecModelDefault } from "./Constants";
import { SecCliConfigurationError } from "./EnvToDI";
import {
  anthropicModelRecord,
  deepSeekModelRecord,
  geminiModelRecord,
  hfInferenceModelRecord,
  hftModelRecord,
  llamaCppModelRecord,
  openAiModelRecord,
  openRouterModelRecord,
  registerModelIds,
  registerSecModels,
  secModelRecord,
  xaiModelRecord,
} from "./registerModels";

describe("registerSecModels", () => {
  const envKeys = [
    "SEC_MODEL_DEFAULT",
    "SEC_S1_MODEL",
    "SEC_MERGER_PROXY_MODEL",
    "SEC_REDEMPTION_MODEL",
    "SEC_LOI_MODEL",
  ] as const;
  const savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));

  // A bare registry shares the global model repository, so swap in a throwaway
  // repo per test and restore the original — otherwise these registrations leak
  // into sibling suites that assume an empty global repo.
  let original: ModelRepository;

  beforeEach(() => {
    for (const key of envKeys) delete process.env[key];
    original = getGlobalModelRepository();
    setGlobalModelRepository(new InMemoryModelRepository());
  });

  afterEach(() => {
    setGlobalModelRepository(original);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("builds a routable Anthropic record", () => {
    const record = anthropicModelRecord("claude-sonnet-5");
    expect(record.model_id).toBe("claude-sonnet-5");
    expect(record.provider).toBe("ANTHROPIC");
    expect(record.provider_config.model_name).toBe("claude-sonnet-5");
    expect(record.pricing).toEqual({
      currency: "USD",
      input: 2,
      output: 10,
      cached: 0.2,
      cacheWrite: 2.5,
      cacheStoragePerHour: undefined,
    });
  });

  it("builds a routable HFT record", () => {
    const record = hftModelRecord("onnx:onnx-community/Qwen2.5-0.5B-Instruct");
    expect(record.provider).toBe("HF_TRANSFORMERS_ONNX");
    expect(record.provider_config.model_path).toBe("onnx-community/Qwen2.5-0.5B-Instruct");
    expect(record.capabilities).toContain("json-mode");
  });

  it("builds routable OpenAI / Gemini / xAI / DeepSeek records", () => {
    expect(openAiModelRecord("gpt-5.4-mini").provider).toBe("OPENAI");
    expect(openAiModelRecord("gpt-5.4-mini").provider_config.model_name).toBe("gpt-5.4-mini");
    expect(geminiModelRecord("gemini-3-flash-preview").provider).toBe("GOOGLE_GEMINI");
    expect(xaiModelRecord("grok-4.6").provider).toBe("XAI");
    expect(deepSeekModelRecord("deepseek-v4-pro").provider).toBe("DEEPSEEK");
    expect(deepSeekModelRecord("deepseek-v4-pro").provider_config.model_name).toBe(
      "deepseek-v4-pro"
    );
    for (const r of [
      openAiModelRecord("gpt-5.4-mini"),
      geminiModelRecord("gemini-3-flash-preview"),
      xaiModelRecord("grok-4.6"),
      deepSeekModelRecord("deepseek-v4-flash"),
      deepSeekModelRecord("deepseek-v4-pro"),
    ]) {
      expect(r.capabilities).toContain("json-mode");
    }
  });

  it("does not claim vision-input for the text-only DeepSeek models", () => {
    expect(deepSeekModelRecord("deepseek-v4-flash").capabilities).not.toContain("vision-input");
    expect(deepSeekModelRecord("deepseek-v4-flash").capabilities).toContain("text.generation");
  });

  it("dispatches secModelRecord by id shape across all providers", () => {
    expect(secModelRecord("claude-opus-5").provider).toBe("ANTHROPIC");
    expect(secModelRecord("gpt-5.5").provider).toBe("OPENAI");
    expect(secModelRecord("gpt-5.4-mini").provider).toBe("OPENAI");
    expect(secModelRecord("gemini-3.1-pro-preview").provider).toBe("GOOGLE_GEMINI");
    expect(secModelRecord("grok-4.6").provider).toBe("XAI");
    expect(secModelRecord("deepseek-v4-flash").provider).toBe("DEEPSEEK");
    expect(secModelRecord("deepseek-v4-pro").provider).toBe("DEEPSEEK");
    expect(secModelRecord("onnx:onnx-community/Qwen2.5-0.5B-Instruct").provider).toBe(
      "HF_TRANSFORMERS_ONNX"
    );
    expect(secModelRecord("gguf:model.gguf").provider).toBe("LOCAL_LLAMACPP");
    expect(secModelRecord("llama:model.gguf").provider).toBe("LOCAL_LLAMACPP");
    expect(secModelRecord("node-llama:model.gguf").provider).toBe("LOCAL_LLAMACPP");
    expect(secModelRecord("hfi:meta-llama/Llama-3.3-70B-Instruct").provider).toBe("HF_INFERENCE");
    expect(secModelRecord("open-router:anthropic/claude-sonnet-4").provider).toBe("OPENROUTER");
  });

  it("pins an optional inference provider from hfi: / open-router: ids onto provider_config", () => {
    const bareHfi = hfInferenceModelRecord("hfi:meta-llama/Llama-3.3-70B-Instruct");
    expect(bareHfi.provider_config).toEqual({ model_name: "meta-llama/Llama-3.3-70B-Instruct" });

    const routedHfi = hfInferenceModelRecord("hfi:together:meta-llama/Llama-3.3-70B-Instruct");
    expect(routedHfi.provider_config).toEqual({
      model_name: "meta-llama/Llama-3.3-70B-Instruct",
      provider: "together",
    });

    const bareOr = openRouterModelRecord("open-router:anthropic/claude-sonnet-4");
    expect(bareOr.provider_config).toEqual({ model_name: "anthropic/claude-sonnet-4" });

    const routedOr = openRouterModelRecord("open-router:Fireworks:deepseek/deepseek-chat");
    expect(routedOr.provider_config).toEqual({
      model_name: "deepseek/deepseek-chat",
      provider_routing: { only: ["Fireworks"], allow_fallbacks: false },
    });
  });

  it("keeps an OpenRouter variant suffix on the model name instead of reading it as a provider", () => {
    // OpenRouter ids carry colon-suffixed variants (`:thinking`, `:free`,
    // `:nitro`, `:online`). Splitting on the FIRST colon read
    // `anthropic/claude-sonnet-4` as a routing provider and `thinking` as the
    // entire model name — a request hard-pinned (`allow_fallbacks: false`) to a
    // provider that does not exist, for a model that does not exist. The
    // separator only counts when it precedes the first `/`.
    const variant = openRouterModelRecord("open-router:anthropic/claude-sonnet-4:thinking");
    expect(variant.provider_config).toEqual({
      model_name: "anthropic/claude-sonnet-4:thinking",
    });

    const free = openRouterModelRecord("open-router:deepseek/deepseek-chat:free");
    expect(free.provider_config).toEqual({ model_name: "deepseek/deepseek-chat:free" });

    // A provider AND a variant still split at the right colon: the one before
    // the slash is the separator, the one after belongs to the model id.
    const both = openRouterModelRecord("open-router:Fireworks:deepseek/deepseek-chat:nitro");
    expect(both.provider_config).toEqual({
      model_name: "deepseek/deepseek-chat:nitro",
      provider_routing: { only: ["Fireworks"], allow_fallbacks: false },
    });

    // The same rule on the hfi: side, which shares the splitter.
    const hfiVariant = hfInferenceModelRecord("hfi:meta-llama/Llama-3.3-70B-Instruct:fast");
    expect(hfiVariant.provider_config).toEqual({
      model_name: "meta-llama/Llama-3.3-70B-Instruct:fast",
    });
  });

  it("points a bare org/name id at the prefix it now needs", () => {
    // `org/name` used to route to the local ONNX provider. Listing every legal
    // shape leaves the operator to spot that one of them is their own id plus
    // five characters, which is the single likeliest reason a working
    // SEC_HFT_MODEL / --models value stopped resolving.
    let message = "";
    try {
      secModelRecord("onnx-community/Qwen3-4B-Instruct-2507-ONNX");
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("onnx:onnx-community/Qwen3-4B-Instruct-2507-ONNX");
    expect(message).toContain("hfi:onnx-community/Qwen3-4B-Instruct-2507-ONNX");
    expect(message).toContain("open-router:onnx-community/Qwen3-4B-Instruct-2507-ONNX");

    // An id with no slash cannot be a repo id, so it gets no misleading hint.
    let plain = "";
    try {
      secModelRecord("sonnet-5");
    } catch (e) {
      plain = e instanceof Error ? e.message : String(e);
    }
    expect(plain).not.toContain("bare");
  });

  it("rejects empty inference-provider or model segments on gated ids", () => {
    for (const id of [
      "hfi:together:",
      "hfi::meta-llama/Llama-3.3-70B-Instruct",
      "open-router:Fireworks:",
      "open-router::deepseek/deepseek-chat",
    ]) {
      expect(() => secModelRecord(id)).toThrow(SecCliConfigurationError);
    }
  });

  it("throws on a model id matching no provider shape instead of defaulting to Anthropic", () => {
    // Regression: these used to mint an ANTHROPIC record, so a typo or an
    // unwired provider only surfaced downstream as a `404 model: <id>` from the
    // Anthropic API — the wrong provider's error, well after registration.
    // Bare `org/name` is also unknown now — it needs an explicit `onnx:` /
    // `hfi:` / `open-router:` prefix.
    for (const id of [
      "sonnet-5",
      "llama-4-70b",
      "mistral-large",
      "onnx-community/Qwen2.5-0.5B-Instruct",
      "",
    ]) {
      expect(() => secModelRecord(id)).toThrow(SecCliConfigurationError);
    }
    expect(() => secModelRecord("claude--typo")).not.toThrow();
  });

  it("names the offending id and the accepted shapes when it throws", () => {
    expect(() => secModelRecord("deepseek-v4-flash".replace("deepseek", "deapseek"))).toThrow(
      /deapseek-v4-flash.*deepseek-\*/s
    );
  });

  it("routes a deepseek-ai HuggingFace repo id via onnx: to the local ONNX provider, not DeepSeek cloud", () => {
    expect(secModelRecord("onnx:deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B").provider).toBe(
      "HF_TRANSFORMERS_ONNX"
    );
    expect(secModelRecord("deepseek-v4-flash").provider).toBe("DEEPSEEK");
  });

  it("registers every id in a CSV model env var, not the comma-joined string", async () => {
    process.env.SEC_S1_MODEL = "claude-haiku-4-5,gpt-5.4-mini";
    await registerSecModels();
    const repo = getGlobalModelRepository();
    expect((await repo.findByName("claude-haiku-4-5"))?.provider).toBe("ANTHROPIC");
    expect((await repo.findByName("gpt-5.4-mini"))?.provider).toBe("OPENAI");
    expect(await repo.findByName("claude-haiku-4-5,gpt-5.4-mini")).toBeUndefined();
  });

  it("registers the cloud default + local HFT default so findByName resolves them", async () => {
    await registerSecModels();
    const repo = getGlobalModelRepository();
    // Assert against the configured default, not a literal id: what this test
    // is for is that whatever `SecModelDefault` names gets registered and
    // resolves — pinning "claude-sonnet-5" here made changing the default fail
    // a test whose own name says "the cloud default". The provider comes from
    // `secModelRecord`'s id-shape dispatch, so it is derived for the same reason.
    expect((await repo.findByName(SecModelDefault))?.provider).toBe(
      secModelRecord(SecModelDefault).provider
    );
    expect((await repo.findByName(SecHftModelDefault))?.provider).toBe("HF_TRANSFORMERS_ONNX");
  });

  it("pins the built-in default to Anthropic so a key-only deployment resolves", () => {
    // Deliberately NOT derived from SecModelDefault: the derived test above
    // asserts the wiring, so nothing failed when the built-in value itself was
    // changed. A default whose provider a deployment has no key for
    // dead-letters every AI section with MODEL_RESOLUTION_ERROR. Adopting
    // another tier is an env-var opt-in (SEC_MODEL_DEFAULT / a per-extractor
    // variable), not a change here. Schema conformance is not a reason to
    // change this id — libs enforces the schema for json-mode providers.
    expect(DEFAULT_SEC_MODEL).toBe("claude-sonnet-5");
    expect(secModelRecord(DEFAULT_SEC_MODEL).provider).toBe("ANTHROPIC");
    // `.env.test` sets no SEC_MODEL_DEFAULT, and beforeEach deletes it, so the
    // exported default is what the extractors actually resolve to here.
    expect(SecModelDefault).toBe(DEFAULT_SEC_MODEL);
  });

  it("is idempotent — a second run does not duplicate or throw", async () => {
    await registerSecModels();
    const size = await getGlobalModelRepository().size();
    await registerSecModels();
    expect(await getGlobalModelRepository().size()).toBe(size);
  });

  it("registerModelIds registers an explicit list by provider-appropriate record", async () => {
    await registerModelIds([
      "claude-haiku-4-5",
      "gpt-5.4-mini",
      "onnx:onnx-community/tiny",
      "hfi:meta-llama/Llama-3.3-70B-Instruct",
      "open-router:anthropic/claude-sonnet-4",
    ]);
    const repo = getGlobalModelRepository();
    expect((await repo.findByName("claude-haiku-4-5"))?.provider).toBe("ANTHROPIC");
    expect((await repo.findByName("gpt-5.4-mini"))?.provider).toBe("OPENAI");
    expect((await repo.findByName("onnx:onnx-community/tiny"))?.provider).toBe(
      "HF_TRANSFORMERS_ONNX"
    );
    expect((await repo.findByName("hfi:meta-llama/Llama-3.3-70B-Instruct"))?.provider).toBe(
      "HF_INFERENCE"
    );
    expect((await repo.findByName("open-router:anthropic/claude-sonnet-4"))?.provider).toBe(
      "OPENROUTER"
    );
  });

  describe("llamaCppModelRecord GGUF id parsing", () => {
    const savedGgufEnv = {
      SEC_GGUF_DIR: process.env.SEC_GGUF_DIR,
      SEC_RAW_DATA_FOLDER: process.env.SEC_RAW_DATA_FOLDER,
    };
    beforeEach(() => {
      process.env.SEC_GGUF_DIR = "/models/gguf";
      delete process.env.SEC_RAW_DATA_FOLDER;
    });
    afterEach(() => {
      for (const [key, value] of Object.entries(savedGgufEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it("keeps a relative local path under the models dir, no download url", () => {
      const config = llamaCppModelRecord("gguf:Bonsai-27B-Q2_0.gguf").provider_config;
      expect(config.model_path).toBe("/models/gguf/Bonsai-27B-Q2_0.gguf");
      expect(config.model_url).toBeUndefined();
      expect(config.models_dir).toBeUndefined();
    });

    it("keeps an absolute local path as-is", () => {
      const config = llamaCppModelRecord("gguf:/abs/model.gguf").provider_config;
      expect(config.model_path).toBe("/abs/model.gguf");
      expect(config.model_url).toBeUndefined();
    });

    it("turns an hf: URI into a download source + cache target (full path, collision-safe)", () => {
      const config = llamaCppModelRecord(
        "gguf:hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q4_K_M"
      ).provider_config;
      expect(config.model_url).toBe("hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q4_K_M");
      expect(config.models_dir).toBe("/models/gguf");
      expect(config.model_path).toBe(
        "/models/gguf/bartowski-SmolLM2-135M-Instruct-GGUF-Q4_K_M.gguf"
      );
    });

    it("classifies an uppercase HF: URI as remote (case-insensitive)", () => {
      const config = llamaCppModelRecord("gguf:HF:org/repo:Q4").provider_config;
      expect(config.model_url).toBe("HF:org/repo:Q4");
      expect(config.models_dir).toBe("/models/gguf");
      expect(config.model_path).toBe("/models/gguf/org-repo-Q4.gguf");
    });

    it("derives distinct cache targets for same-repo-name different-org URIs", () => {
      const a = llamaCppModelRecord("gguf:hf:org1/repo:Q4").provider_config.model_path;
      const b = llamaCppModelRecord("gguf:hf:org2/repo:Q4").provider_config.model_path;
      expect(a).not.toBe(b);
      expect(a).toBe("/models/gguf/org1-repo-Q4.gguf");
      expect(b).toBe("/models/gguf/org2-repo-Q4.gguf");
    });

    it("turns an https URL into a download source + cache target (full path, collision-safe)", () => {
      const config = llamaCppModelRecord(
        "gguf:https://host.example/a/b/model.gguf"
      ).provider_config;
      expect(config.model_url).toBe("https://host.example/a/b/model.gguf");
      expect(config.models_dir).toBe("/models/gguf");
      expect(config.model_path).toBe("/models/gguf/host.example-a-b-model.gguf");
    });

    it("accepts llama: and node-llama: as aliases of gguf:", () => {
      expect(llamaCppModelRecord("llama:Bonsai-27B-Q2_0.gguf").provider_config.model_path).toBe(
        "/models/gguf/Bonsai-27B-Q2_0.gguf"
      );
      expect(
        llamaCppModelRecord("node-llama:Bonsai-27B-Q2_0.gguf").provider_config.model_path
      ).toBe("/models/gguf/Bonsai-27B-Q2_0.gguf");
      expect(llamaCppModelRecord("llama:hf:org/repo:Q4").provider_config.model_url).toBe(
        "hf:org/repo:Q4"
      );
    });
  });

  it("registers the SEC_LOI_MODEL override id", async () => {
    process.env.SEC_LOI_MODEL = "claude-haiku-4-5";
    await registerSecModels();
    const repo = getGlobalModelRepository();
    expect((await repo.findByName("claude-haiku-4-5"))?.provider).toBe("ANTHROPIC");
    // The two always-registered defaults (cloud + local HFT) plus the override.
    expect(await repo.size()).toBe(3);
  });
});

describe("OpenAI reasoning effort", () => {
  const KEY = "SEC_OPENAI_REASONING_EFFORT";
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("expresses no preference by default, leaving the provider to decide", () => {
    // The provider forces reasoning off for any request that pins a
    // temperature — gpt-5.6-luna 400s on `temperature` while reasoning is on,
    // but accepts {reasoning:{effort:"none"}, temperature:0}. Naming an effort
    // here would override that inference.
    delete process.env[KEY];
    const record = openAiModelRecord("gpt-5.6-luna");
    expect((record.provider_config as Record<string, unknown>).reasoning).toBeUndefined();
  });

  it("honours an explicit effort", () => {
    process.env[KEY] = "high";
    expect(
      (openAiModelRecord("gpt-5.6-luna").provider_config as Record<string, unknown>).reasoning
    ).toEqual({ effort: "high" });
  });

  it("omits the reasoning field entirely when set empty", () => {
    process.env[KEY] = "";
    expect(
      (openAiModelRecord("gpt-5.6-luna").provider_config as Record<string, unknown>).reasoning
    ).toBeUndefined();
  });
});
