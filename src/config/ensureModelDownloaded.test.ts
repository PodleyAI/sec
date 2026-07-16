/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ensureModelDownloaded,
  resetEnsuredModelsForTesting,
} from "./ensureModelDownloaded";

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
    await expect(ensureModelDownloaded(cloud("claude-sonnet-5", "ANTHROPIC"))).resolves.toBeUndefined();
    await expect(ensureModelDownloaded(cloud("gpt-5.5", "OPENAI"))).resolves.toBeUndefined();
    await expect(
      ensureModelDownloaded(cloud("gemini-3-flash-preview", "GOOGLE_GEMINI"))
    ).resolves.toBeUndefined();
    await expect(ensureModelDownloaded(cloud("grok-4.5", "XAI"))).resolves.toBeUndefined();
  });

  it("skips a bare-path GGUF (no model_url): the file is assumed on disk", async () => {
    await expect(
      ensureModelDownloaded(llamaCpp("gguf:/models/x.gguf", { model_path: "/models/x.gguf" }))
    ).resolves.toBeUndefined();
  });

  it("attempts a download for a HuggingFace ONNX model", async () => {
    await expect(ensureModelDownloaded(hft("onnx-community/x"))).rejects.toThrow(/model\.download/);
  });

  it("attempts a download for a GGUF model that has a model_url", async () => {
    await expect(
      ensureModelDownloaded(
        llamaCpp("gguf:hf:org/repo:Q4_K_M", {
          model_path: "/models/repo-Q4_K_M.gguf",
          model_url: "hf:org/repo:Q4_K_M",
          models_dir: "/models",
        })
      )
    ).rejects.toThrow(/model\.download/);
  });

  it("downloads each model at most once (memoized across calls)", async () => {
    const id = "gguf:memo.gguf";
    // First mark the id ready via the bare-path (no-op) branch.
    await ensureModelDownloaded(llamaCpp(id, { model_path: "/models/memo.gguf" }));
    // A later record with the SAME id would normally attempt a download and
    // reject — but the memo short-circuits it, so it resolves cleanly.
    await expect(
      ensureModelDownloaded(
        llamaCpp(id, { model_path: "/models/memo.gguf", model_url: "hf:org/memo:Q4" })
      )
    ).resolves.toBeUndefined();
    // Sanity: without the memo, the url-bearing record does attempt (and reject).
    resetEnsuredModelsForTesting();
    await expect(
      ensureModelDownloaded(
        llamaCpp(id, { model_path: "/models/memo.gguf", model_url: "hf:org/memo:Q4" })
      )
    ).rejects.toThrow(/model\.download/);
  });
});
