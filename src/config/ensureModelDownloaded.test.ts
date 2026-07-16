/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, ModelConfig } from "workglow";
import {
  AiProviderRegistry,
  getAiProviderRegistry,
  setAiProviderRegistry,
} from "workglow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureModelDownloaded,
  resetEnsuredModelsForTesting,
} from "./ensureModelDownloaded";

/** A throwaway execute context — these tests never reach a real provider. */
const ctx = (): IExecuteContext =>
  ({
    signal: new AbortController().signal,
    updateProgress: async () => {},
    own: <T>(v: T): T => v,
    registry: { has: () => false, get: () => { throw new Error("x"); } },
    resourceScope: { register: () => {}, dispose: async () => {} },
  }) as unknown as IExecuteContext;

/**
 * No AI providers are registered in this suite, so any model that actually
 * dispatches `ModelDownloadTask` rejects fast with "No run function found …
 * model.download". We use that as the observable signal that a download was
 * *attempted*; a clean resolve is the signal that it was *skipped* (a no-op).
 */
const cloud = (id: string, provider: string): ModelConfig =>
  ({ model_id: id, provider, provider_config: { model_name: id } }) as unknown as ModelConfig;

const llamaCpp = (id: string, provider_config: Record<string, unknown>): ModelConfig =>
  ({ model_id: id, provider: "LOCAL_LLAMACPP", provider_config }) as unknown as ModelConfig;

const hft = (id: string): ModelConfig =>
  ({
    model_id: id,
    provider: "HF_TRANSFORMERS_ONNX",
    provider_config: { model_path: id },
  }) as unknown as ModelConfig;

describe("ensureModelDownloaded", () => {
  beforeEach(() => {
    resetEnsuredModelsForTesting();
  });

  it("is a no-op for cloud providers (nothing to download)", async () => {
    await expect(ensureModelDownloaded(cloud("claude-sonnet-5", "ANTHROPIC"), ctx())).resolves.toBeUndefined();
    await expect(ensureModelDownloaded(cloud("gpt-5.5", "OPENAI"), ctx())).resolves.toBeUndefined();
    await expect(
      ensureModelDownloaded(cloud("gemini-3-flash-preview", "GOOGLE_GEMINI"), ctx())
    ).resolves.toBeUndefined();
    await expect(ensureModelDownloaded(cloud("grok-4.5", "XAI"), ctx())).resolves.toBeUndefined();
  });

  it("skips a bare-path GGUF (no model_url): the file is assumed on disk", async () => {
    await expect(
      ensureModelDownloaded(llamaCpp("gguf:/models/x.gguf", { model_path: "/models/x.gguf" }), ctx())
    ).resolves.toBeUndefined();
  });

  it("attempts a download for a HuggingFace ONNX model", async () => {
    await expect(ensureModelDownloaded(hft("onnx-community/x"), ctx())).rejects.toThrow();
  });

  it("attempts a download for a GGUF model that has a model_url", async () => {
    await expect(
      ensureModelDownloaded(
        llamaCpp("gguf:hf:org/repo:Q4_K_M", {
          model_path: "/models/repo-Q4_K_M.gguf",
          model_url: "hf:org/repo:Q4_K_M",
          models_dir: "/models",
        }),
        ctx()
      )
    ).rejects.toThrow();
  });

  it("downloads each model at most once (memoized across calls)", async () => {
    const id = "gguf:memo.gguf";
    // First mark the id ready via the bare-path (no-op) branch.
    await ensureModelDownloaded(llamaCpp(id, { model_path: "/models/memo.gguf" }), ctx());
    // A later record with the SAME id would normally attempt a download and
    // reject — but the memo short-circuits it, so it resolves cleanly.
    await expect(
      ensureModelDownloaded(
        llamaCpp(id, { model_path: "/models/memo.gguf", model_url: "hf:org/memo:Q4" }),
        ctx()
      )
    ).resolves.toBeUndefined();
    // Sanity: without the memo, the url-bearing record does attempt (and reject).
    resetEnsuredModelsForTesting();
    await expect(
      ensureModelDownloaded(
        llamaCpp(id, { model_path: "/models/memo.gguf", model_url: "hf:org/memo:Q4" }),
        ctx()
      )
    ).rejects.toThrow();
  });

  describe("progress + abort forwarding", () => {
    // Swap in a throwaway provider registry so a fake download run-fn doesn't leak
    // into sibling suites, mirroring registerModels.test's model-repo swap.
    let original: AiProviderRegistry;
    beforeEach(() => {
      original = getAiProviderRegistry();
      setAiProviderRegistry(new AiProviderRegistry());
      resetEnsuredModelsForTesting();
    });
    afterEach(() => {
      setAiProviderRegistry(original);
    });

    it("forwards the download run-fn's progress to context.updateProgress (and memoizes)", async () => {
      let runFnCalls = 0;
      // Real provider run-fns are plain async fns that push events via `emit`
      // (see LlamaCpp_Download), not generators.
      getAiProviderRegistry().registerRunFn("HF_TRANSFORMERS_ONNX", {
        serves: ["model.download"],
        runFn: async (input: any, _model: any, _signal: any, emit: any) => {
          runFnCalls += 1;
          emit({ type: "phase", message: "Downloading model", progress: 42 });
          emit({ type: "finish", data: { model: input.model } });
        },
      } as any);

      const progress: Array<[number | undefined, string | undefined]> = [];
      const context = {
        signal: new AbortController().signal,
        updateProgress: async (p: number | undefined, m?: string) => {
          progress.push([p, m]);
        },
        own: <T>(v: T): T => v,
        registry: { has: () => false, get: () => { throw new Error("x"); } },
        resourceScope: { register: () => {}, dispose: async () => {} },
      } as unknown as IExecuteContext;

      const model = hft("onnx-community/progress");
      await ensureModelDownloaded(model, context);
      // The download's phase event reached the running task's progress sink — this
      // is what the withCli UI renders on screen.
      expect(runFnCalls).toBe(1);
      expect(progress).toContainEqual([42, "Downloading model"]);

      // Memoized: a second call does not re-invoke the download run-fn.
      await ensureModelDownloaded(model, context);
      expect(runFnCalls).toBe(1);
    });

    it("memoizes a model identified by `model` (no model_id)", async () => {
      let runFnCalls = 0;
      getAiProviderRegistry().registerRunFn("HF_TRANSFORMERS_ONNX", {
        serves: ["model.download"],
        runFn: async (input: any, _m: any, _s: any, emit: any) => {
          runFnCalls += 1;
          emit({ type: "finish", data: { model: input.model } });
        },
      } as any);
      const context = {
        signal: new AbortController().signal,
        updateProgress: async () => {},
        own: <T>(v: T): T => v,
        registry: { has: () => false, get: () => { throw new Error("x"); } },
        resourceScope: { register: () => {}, dispose: async () => {} },
      } as unknown as IExecuteContext;
      // No model_id — identity comes from `model` (mirrors resolveModelId's fallback).
      const model = {
        model: "onnx-community/no-id",
        provider: "HF_TRANSFORMERS_ONNX",
        provider_config: { model_path: "onnx-community/no-id" },
      } as unknown as ModelConfig;
      await ensureModelDownloaded(model, context);
      await ensureModelDownloaded(model, context);
      expect(runFnCalls).toBe(1);
    });
  });
});
