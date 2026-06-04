/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ObservationProvenanceRepo } from "./ObservationProvenanceRepo";

describe("ObservationProvenanceRepo", () => {
  let repo: ObservationProvenanceRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = new ObservationProvenanceRepo();
  });

  it("saves and retrieves provenance by (kind, observation_id)", async () => {
    await repo.save({
      kind: "person",
      observation_id: 42,
      confidence: 0.91,
      source_span: "Jane Roe has served as a director since 2021",
      section_name: "Management",
      model_id: "fake-model",
      prompt_version: "1.0.0",
      extra: null,
    });
    const got = await repo.get("person", 42);
    expect(got?.confidence).toBe(0.91);
    expect(got?.section_name).toBe("Management");
    expect(typeof got?.created_at).toBe("string");
  });

  it("lists rows below a confidence threshold", async () => {
    await repo.save({
      kind: "person",
      observation_id: 1,
      confidence: 0.4,
      source_span: null,
      section_name: "Management",
      model_id: "m",
      prompt_version: "1.0.0",
      extra: null,
    });
    await repo.save({
      kind: "person",
      observation_id: 2,
      confidence: 0.95,
      source_span: null,
      section_name: "Management",
      model_id: "m",
      prompt_version: "1.0.0",
      extra: null,
    });
    const low = await repo.listBelowConfidence(0.7);
    expect(low.map((r) => r.observation_id).sort()).toEqual([1]);
  });
});
