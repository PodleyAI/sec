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
  hftModelRecord,
  registerModelIds,
  registerSecModels,
  secModelRecord,
} from "./registerModels";

describe("registerSecModels", () => {
  const envKeys = [
    "SEC_MODEL_DEFAULT",
    "SEC_S1_MODEL",
    "SEC_MERGER_PROXY_MODEL",
    "SEC_REDEMPTION_MODEL",
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

  it("dispatches secModelRecord by id shape (org/name → HFT, else Anthropic)", () => {
    expect(secModelRecord("claude-opus-4-8").provider).toBe("ANTHROPIC");
    expect(secModelRecord("onnx-community/Qwen2.5-0.5B-Instruct").provider).toBe(
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
    await registerModelIds(["claude-haiku-4-5", "onnx-community/tiny"]);
    const repo = getGlobalModelRepository();
    expect((await repo.findByName("claude-haiku-4-5"))?.provider).toBe("ANTHROPIC");
    expect((await repo.findByName("onnx-community/tiny"))?.provider).toBe("HF_TRANSFORMERS_ONNX");
  });
});
