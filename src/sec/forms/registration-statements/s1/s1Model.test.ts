/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { ModelConfig } from "workglow";
import { DETERMINISTIC_MODEL_ID } from "../../../../config/Constants";
import { deterministicModelConfig, modelExtractChain, resolveModelId } from "./s1Model";

function ai(id: string): ModelConfig {
  return {
    model_id: id,
    provider: "fake",
    capabilities: [],
    provider_config: {},
    metadata: {},
  } as ModelConfig;
}

describe("deterministicModelConfig", () => {
  it("exposes the reserved id", () => {
    expect(resolveModelId(deterministicModelConfig())).toBe(DETERMINISTIC_MODEL_ID);
  });
});

describe("modelExtractChain", () => {
  it("runs the pass at the deterministic slot and the AI extract at others", async () => {
    const seen: string[] = [];
    const chain = modelExtractChain(
      [deterministicModelConfig(), ai("claude-haiku-4-5")],
      async (_text, m) => {
        seen.push(resolveModelId(m) ?? "none");
        return [{ confidence: 1 }];
      },
      {
        deterministic: {
          extract: () => [{ confidence: 1, via: "walk" }],
          covers: new Set(["t"]),
        },
        clears: new Set(["t"]),
      }
    );
    expect(chain.modelIds).toEqual(["deterministic", "claude-haiku-4-5"]);
    const walk = await chain.extract("hello");
    expect(walk).toEqual([{ confidence: 1, via: "walk" }]);
    expect(seen).toEqual([]);
    const fallback = await chain.emptyExtracts![0]!("hello");
    expect(fallback).toEqual([{ confidence: 1 }]);
    expect(seen).toEqual(["claude-haiku-4-5"]);
  });

  it("returns [] for a deterministic slot when no pass is provided", async () => {
    const chain = modelExtractChain([deterministicModelConfig()], async () => [{ confidence: 1 }]);
    expect(await chain.extract("x")).toEqual([]);
  });

  it("returns [] when covers does not preempt clears", async () => {
    const chain = modelExtractChain([deterministicModelConfig()], async () => [{ confidence: 1 }], {
      deterministic: {
        extract: () => [{ confidence: 1, via: "walk" }],
        covers: new Set(["a"]),
      },
      clears: new Set(["a", "b"]),
    });
    expect(await chain.extract("x")).toEqual([]);
  });

  it("places the walk last when deterministic is last in the list", async () => {
    const chain = modelExtractChain(
      [ai("claude-haiku-4-5"), deterministicModelConfig()],
      async () => [{ confidence: 0.9, via: "ai" }],
      {
        deterministic: {
          extract: () => [{ confidence: 1, via: "walk" }],
          covers: new Set(["t"]),
        },
        clears: new Set(["t"]),
      }
    );
    expect(await chain.extract("x")).toEqual([{ confidence: 0.9, via: "ai" }]);
    expect(await chain.emptyExtracts![0]!("x")).toEqual([{ confidence: 1, via: "walk" }]);
  });
});
