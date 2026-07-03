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
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { anthropicModelRecord, registerSecModels } from "./registerModels";

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

  it("registers the default model so findByName resolves it", async () => {
    await registerSecModels();
    const record = await getGlobalModelRepository().findByName("claude-sonnet-5");
    expect(record?.provider).toBe("ANTHROPIC");
    expect(record?.provider_config?.model_name).toBe("claude-sonnet-5");
  });

  it("is idempotent — a second run does not duplicate or throw", async () => {
    await registerSecModels();
    await registerSecModels();
    expect(await getGlobalModelRepository().size()).toBe(1);
  });

  it("also registers a per-extractor override model id", async () => {
    // SecModelDefault is captured at import (claude-sonnet-5 with env unset); the
    // per-extractor override is read fresh from the env by secModelIds().
    process.env.SEC_REDEMPTION_MODEL = "claude-haiku-4-5";
    await registerSecModels();
    const repo = getGlobalModelRepository();
    expect((await repo.findByName("claude-sonnet-5"))?.provider).toBe("ANTHROPIC");
    expect((await repo.findByName("claude-haiku-4-5"))?.provider).toBe("ANTHROPIC");
    expect(await repo.size()).toBe(2);
  });
});
