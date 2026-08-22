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
    registry: {
      has: () => false,
      get: () => {
        throw new Error("x");
      },
    },
    resourceScope: { register: () => {}, dispose: async () => {} },
  }) as unknown as IExecuteContext;

/**
 * The task figures out the provider (and its download/verify config) from the
 * model id *shape* alone, via `secModelRecord` — no resolved `ModelConfig` is
 * handed in. No AI providers are registered unless a describe block installs
 * them, so a downloadable id rejects with "No run function found … model.download"
 * and a cloud id rejects with "… model.info" — those throws are the observable
 * signal that the matching path was taken. A clean resolve means the id was
 * skipped (unknown shape / bare GGUF) or a stub run-fn succeeded.
 */
describe("EnsureModelDownloadedTask / ensureModelDownloaded", () => {
  beforeEach(() => {
    resetEnsuredModelsForTesting();
  });

  it("attempts ModelInfo verification for cloud ids (no run-fn → rejects)", async () => {
    // claude-* → Anthropic, gpt-* → OpenAI, gemini-* → Gemini, grok-* → xAI —
    // all cloud, so verify via model.info rather than download.
    await expect(ensureModelDownloaded("claude-sonnet-5", ctx())).rejects.toThrow(/model\.info/i);
    await expect(ensureModelDownloaded("gpt-5.5", ctx())).rejects.toThrow(/model\.info/i);
    await expect(ensureModelDownloaded("gemini-3-flash-preview", ctx())).rejects.toThrow(
      /model\.info/i
    );
    await expect(ensureModelDownloaded("grok-4.6", ctx())).rejects.toThrow(/model\.info/i);
  });

  it("no-ops for the deterministic reserved id", async () => {
    await expect(ensureModelDownloaded("deterministic", ctx())).resolves.toBeUndefined();
  });

  it("is a no-op for an id whose shape sec does not route", async () => {
    // Such an id is legal — a record registered straight into the model
    // repository by an operator, a harness, or a test fixture. It is simply not
    // ours to download/verify, so this must skip rather than reject.
    await expect(ensureModelDownloaded("fake-s1-model", ctx())).resolves.toBeUndefined();
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

  describe("cloud ModelInfo verification", () => {
    let original: AiProviderRegistry;
    beforeEach(() => {
      original = getAiProviderRegistry();
      setAiProviderRegistry(new AiProviderRegistry());
      resetEnsuredModelsForTesting();
    });
    afterEach(() => {
      setAiProviderRegistry(original);
    });

    it("succeeds and memoizes when model.info verifies the cloud id", async () => {
      let runFnCalls = 0;
      getAiProviderRegistry().registerRunFn("ANTHROPIC", {
        serves: ["model.info"],
        runFn: async (input: any, _m: any, _s: any, emit: any) => {
          runFnCalls += 1;
          emit({
            type: "finish",
            data: {
              model: input.model,
              is_local: false,
              is_remote: true,
              supports_browser: true,
              supports_node: true,
              is_cached: false,
              is_loaded: false,
              file_sizes: null,
            },
          });
        },
      } as any);

      const owned: unknown[] = [];
      const counting = {
        ...ctx(),
        own: <T>(v: T): T => {
          owned.push(v);
          return v;
        },
      } as unknown as IExecuteContext;

      await ensureModelDownloaded("claude-haiku-4-5", counting);
      expect(runFnCalls).toBe(1);
      expect(owned).toHaveLength(1);

      await ensureModelDownloaded("claude-haiku-4-5", counting);
      await ensureModelDownloaded("claude-haiku-4-5", counting);
      expect(runFnCalls).toBe(1);
      expect(owned).toHaveLength(1);
    });

    it("throws when model.info reports the cloud model missing", async () => {
      getAiProviderRegistry().registerRunFn("ANTHROPIC", {
        serves: ["model.info"],
        runFn: async () => {
          throw new Error('ANTHROPIC model "claude-haiku-4-5" was not found');
        },
      } as any);

      await expect(ensureModelDownloaded("claude-haiku-4-5", ctx())).rejects.toThrow(/not found/i);
    });

    it("reports verified=true downloaded=false for a cloud id via EnsureModelDownloadedTask.run", async () => {
      getAiProviderRegistry().registerRunFn("OPENAI", {
        serves: ["model.info"],
        runFn: async (input: any, _m: any, _s: any, emit: any) => {
          emit({
            type: "finish",
            data: {
              model: input.model,
              is_local: false,
              is_remote: true,
              supports_browser: true,
              supports_node: true,
              is_cached: false,
              is_loaded: false,
              file_sizes: null,
            },
          });
        },
      } as any);

      const input = { model: "gpt-5.5" };
      const out = await new EnsureModelDownloadedTask({ defaults: input }).run(input);
      expect(out.downloaded).toBe(false);
      expect(out.verified).toBe(true);
    });
  });

  describe("progress + abort forwarding", () => {
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
        registry: {
          has: () => false,
          get: () => {
            throw new Error("x");
          },
        },
        resourceScope: { register: () => {}, dispose: async () => {} },
      } as unknown as IExecuteContext;

      await ensureModelDownloaded("onnx:onnx-community/progress", context);
      expect(runFnCalls).toBe(1);
      expect(progress).toContainEqual([42, "Downloading model"]);

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
      expect(out.verified).toBe(false);
      expect(runFnCalls).toBe(1);
    });
  });

  describe("concurrent callers", () => {
    let original: AiProviderRegistry;
    beforeEach(() => {
      original = getAiProviderRegistry();
      setAiProviderRegistry(new AiProviderRegistry());
      resetEnsuredModelsForTesting();
    });
    afterEach(() => {
      setAiProviderRegistry(original);
    });

    /** Resolves only once `release()` is called, so both callers are in flight together. */
    function gate(): { readonly wait: Promise<void>; release: () => void } {
      let release = (): void => {};
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { wait, release };
    }

    it("runs the download once when two callers start before either finishes", async () => {
      // `ensured` is written only AFTER the await resolves, so two callers that
      // both start first both miss the memo and both run — two concurrent
      // multi-GB fetches writing the same file. Reachable as soon as anything
      // above runs models in parallel.
      const g = gate();
      let runFnCalls = 0;
      getAiProviderRegistry().registerRunFn("HF_TRANSFORMERS_ONNX", {
        serves: ["model.download"],
        runFn: async (input: any, _m: any, _s: any, emit: any) => {
          runFnCalls += 1;
          await g.wait;
          emit({ type: "finish", data: { model: input.model } });
        },
      } as any);

      const both = Promise.all([
        ensureModelDownloaded("onnx:onnx-community/race", ctx()),
        ensureModelDownloaded("onnx:onnx-community/race", ctx()),
      ]);
      g.release();
      await both;

      expect(runFnCalls).toBe(1);
    });

    it("does not memoize a failure, so a later retry runs again", async () => {
      // The in-flight entry must be dropped on the reject path too: a check
      // that failed for a missing key must run for real once the key is set.
      let runFnCalls = 0;
      let fail = true;
      getAiProviderRegistry().registerRunFn("ANTHROPIC", {
        serves: ["model.info"],
        runFn: async (input: any, _m: any, _s: any, emit: any) => {
          runFnCalls += 1;
          if (fail) throw new Error("ANTHROPIC_API_KEY is not set");
          emit({
            type: "finish",
            data: {
              model: input.model,
              is_local: false,
              is_remote: true,
              supports_browser: true,
              supports_node: true,
              is_cached: false,
              is_loaded: false,
              file_sizes: null,
            },
          });
        },
      } as any);

      const first = ensureModelDownloaded("claude-haiku-4-5", ctx());
      const second = ensureModelDownloaded("claude-haiku-4-5", ctx());
      await expect(first).rejects.toThrow(/ANTHROPIC_API_KEY/);
      await expect(second).rejects.toThrow(/ANTHROPIC_API_KEY/);
      expect(runFnCalls).toBe(1);

      fail = false;
      await ensureModelDownloaded("claude-haiku-4-5", ctx());
      expect(runFnCalls).toBe(2);
    });
  });
});
