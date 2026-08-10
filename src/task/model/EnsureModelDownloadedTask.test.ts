/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "workglow";
import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "workglow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EnsureModelDownloadedTask,
  ensureModelDownloaded,
  resetEnsuredModelsForTesting,
} from "./EnsureModelDownloadedTask";

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
 * The task figures out the provider (and its download config) from the model id
 * *shape* alone, via `secModelRecord` — no resolved `ModelConfig` is handed in.
 * No AI providers are registered in this suite, so any id that actually dispatches
 * `ModelDownloadTask` rejects fast with "No run function found … model.download".
 * We use that as the observable signal that a download was *attempted*; a clean
 * resolve is the signal that it was *skipped* (a no-op).
 */
describe("EnsureModelDownloadedTask / ensureModelDownloaded", () => {
  beforeEach(() => {
    resetEnsuredModelsForTesting();
  });

  it("is a no-op for cloud ids, whichever provider the name resolves to", async () => {
    // claude-* → Anthropic, gpt-* → OpenAI, gemini-* → Gemini, grok-* → xAI —
    // all cloud, so nothing to download.
    await expect(ensureModelDownloaded("claude-sonnet-5", ctx())).resolves.toBeUndefined();
    await expect(ensureModelDownloaded("gpt-5.5", ctx())).resolves.toBeUndefined();
    await expect(ensureModelDownloaded("gemini-3-flash-preview", ctx())).resolves.toBeUndefined();
    await expect(ensureModelDownloaded("grok-4.5", ctx())).resolves.toBeUndefined();
  });

  it("is a no-op for an id whose shape sec does not route", async () => {
    // Such an id is legal — a record registered straight into the model
    // repository by an operator, a harness, or a test fixture. It is simply not
    // ours to download, so this must skip rather than reject: `secModelRecord`
    // throws on an unrecognized shape, and letting that escape here would fail
    // every extraction driven by a directly-registered model.
    await expect(ensureModelDownloaded("fake-s1-model", ctx())).resolves.toBeUndefined();
  });

  it("owns no task node for a cloud id after the first call", async () => {
    // A sweep calls this once per section. The first call settles "nothing to
    // download"; every later one must short-circuit before `own()`, or the CLI
    // task UI fills with one no-op EnsureModelDownloadedTask row per section.
    const owned: unknown[] = [];
    const counting = {
      ...ctx(),
      own: <T,>(v: T): T => {
        owned.push(v);
        return v;
      },
    } as unknown as IExecuteContext;

    await ensureModelDownloaded("claude-haiku-4-5", counting);
    expect(owned).toHaveLength(1);
    await ensureModelDownloaded("claude-haiku-4-5", counting);
    await ensureModelDownloaded("claude-haiku-4-5", counting);
    expect(owned).toHaveLength(1);
  });

  it("skips a bare-path GGUF id (no model_url): the file is assumed on disk", async () => {
    await expect(ensureModelDownloaded("gguf:/models/x.gguf", ctx())).resolves.toBeUndefined();
  });

  it("attempts a download for a HuggingFace ONNX id (onnx: prefix)", async () => {
    await expect(ensureModelDownloaded("onnx:onnx-community/x", ctx())).rejects.toThrow();
  });

  it("attempts a download for a GGUF id with a remote model_url", async () => {
    await expect(ensureModelDownloaded("gguf:hf:org/repo:Q4_K_M", ctx())).rejects.toThrow();
  });

  it("attempts a download for a llama: id with a remote model_url", async () => {
    await expect(ensureModelDownloaded("llama:hf:org/repo:Q4_K_M", ctx())).rejects.toThrow();
  });

  it("no-ops on an empty id", async () => {
    await expect(ensureModelDownloaded("", ctx())).resolves.toBeUndefined();
    await expect(ensureModelDownloaded(null, ctx())).resolves.toBeUndefined();
    await expect(ensureModelDownloaded(undefined, ctx())).resolves.toBeUndefined();
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

      // The download's phase event, emitted two task layers down (the owned
      // ModelDownloadTask under EnsureModelDownloadedTask), reaches the running
      // task's progress sink — this is what the withCli UI renders on screen.
      await ensureModelDownloaded("onnx:onnx-community/progress", context);
      expect(runFnCalls).toBe(1);
      expect(progress).toContainEqual([42, "Downloading model"]);

      // Memoized: a second call does not re-invoke the download run-fn.
      await ensureModelDownloaded("onnx:onnx-community/progress", context);
      expect(runFnCalls).toBe(1);
    });

    it("runs standalone via EnsureModelDownloadedTask.run and reports `downloaded`", async () => {
      let runFnCalls = 0;
      getAiProviderRegistry().registerRunFn("HF_TRANSFORMERS_ONNX", {
        serves: ["model.download"],
        runFn: async (input: any, _m: any, _s: any, emit: any) => {
          runFnCalls += 1;
          emit({ type: "finish", data: { model: input.model } });
        },
      } as any);

      const input = { model: "onnx:onnx-community/standalone" };
      const out = await new EnsureModelDownloadedTask({ defaults: input }).run(input);
      expect(out.downloaded).toBe(true);
      expect(runFnCalls).toBe(1);
    });
  });
});
