/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRepository } from "workglow";
import {
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "workglow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecHftModelDefault } from "./Constants";
import {
  anthropicModelRecord,
  deepSeekModelRecord,
  geminiModelRecord,
  hftModelRecord,
  llamaCppModelRecord,
  openAiModelRecord,
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
  });

  it("builds a routable HFT record", () => {
    const record = hftModelRecord("onnx-community/Qwen2.5-0.5B-Instruct");
    expect(record.provider).toBe("HF_TRANSFORMERS_ONNX");
    expect(record.provider_config.model_path).toBe("onnx-community/Qwen2.5-0.5B-Instruct");
    expect(record.capabilities).toContain("json-mode");
  });

  it("builds routable OpenAI / Gemini / xAI / DeepSeek records", () => {
    expect(openAiModelRecord("gpt-5.4-mini").provider).toBe("OPENAI");
    expect(openAiModelRecord("gpt-5.4-mini").provider_config.model_name).toBe("gpt-5.4-mini");
    expect(geminiModelRecord("gemini-3-flash-preview").provider).toBe("GOOGLE_GEMINI");
    expect(xaiModelRecord("grok-4.5").provider).toBe("XAI");
    expect(deepSeekModelRecord("deepseek-v4-pro").provider).toBe("DEEPSEEK");
    expect(deepSeekModelRecord("deepseek-v4-pro").provider_config.model_name).toBe(
      "deepseek-v4-pro"
    );
    for (const r of [
      openAiModelRecord("gpt-5.4-mini"),
      geminiModelRecord("gemini-3-flash-preview"),
      xaiModelRecord("grok-4.5"),
      deepSeekModelRecord("deepseek-v4-flash"),
    ]) {
      expect(r.capabilities).toContain("json-mode");
    }
  });

  it("does not claim vision-input for the text-only DeepSeek models", () => {
    expect(deepSeekModelRecord("deepseek-v4-flash").capabilities).not.toContain("vision-input");
    expect(deepSeekModelRecord("deepseek-v4-flash").capabilities).toContain("text.generation");
  });

  it("dispatches secModelRecord by id shape across all providers", () => {
    expect(secModelRecord("claude-opus-4-8").provider).toBe("ANTHROPIC");
    expect(secModelRecord("gpt-5.5").provider).toBe("OPENAI");
    expect(secModelRecord("gpt-5.4-mini").provider).toBe("OPENAI");
    expect(secModelRecord("gemini-3.1-pro-preview").provider).toBe("GOOGLE_GEMINI");
    expect(secModelRecord("grok-4.5").provider).toBe("XAI");
    expect(secModelRecord("deepseek-v4-flash").provider).toBe("DEEPSEEK");
    expect(secModelRecord("deepseek-v4-pro").provider).toBe("DEEPSEEK");
    expect(secModelRecord("onnx-community/Qwen2.5-0.5B-Instruct").provider).toBe(
      "HF_TRANSFORMERS_ONNX"
    );
    expect(secModelRecord("gguf:model.gguf").provider).toBe("LOCAL_LLAMACPP");
  });

  it("routes a deepseek-ai HuggingFace repo id to the local ONNX provider, not DeepSeek cloud", () => {
    expect(secModelRecord("deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B").provider).toBe(
      "HF_TRANSFORMERS_ONNX"
    );
  });

  it("registers the cloud default + local HFT default so findByName resolves them", async () => {
    await registerSecModels();
    const repo = getGlobalModelRepository();
    expect((await repo.findByName("claude-sonnet-5"))?.provider).toBe("ANTHROPIC");
    expect((await repo.findByName(SecHftModelDefault))?.provider).toBe("HF_TRANSFORMERS_ONNX");
  });

  it("is idempotent — a second run does not duplicate or throw", async () => {
    await registerSecModels();
    const size = await getGlobalModelRepository().size();
    await registerSecModels();
    expect(await getGlobalModelRepository().size()).toBe(size);
  });

  it("registerModelIds registers an explicit list by provider-appropriate record", async () => {
    await registerModelIds(["claude-haiku-4-5", "gpt-5.4-mini", "onnx-community/tiny"]);
    const repo = getGlobalModelRepository();
    expect((await repo.findByName("claude-haiku-4-5"))?.provider).toBe("ANTHROPIC");
    expect((await repo.findByName("gpt-5.4-mini"))?.provider).toBe("OPENAI");
    expect((await repo.findByName("onnx-community/tiny"))?.provider).toBe("HF_TRANSFORMERS_ONNX");
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
