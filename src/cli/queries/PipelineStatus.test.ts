/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ADV_ADVISER_REPOSITORY_TOKEN, type AdvAdviser } from "../../storage/adv/AdvAdviserSchema";
import { getPipelineStatus } from "./PipelineStatus";

const adviser = (snapshot: string, crd: string): AdvAdviser => ({
  snapshot,
  crd_number: crd,
  sec_file_number: null,
  legal_name: `Adviser ${crd}`,
  primary_business_name: null,
  is_era: false,
  main_office_city: null,
  main_office_state: null,
  main_office_country: null,
  regulatory_aum: null,
  filing_id: null,
  date_submitted: null,
});

describe("getPipelineStatus's ADV line", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  const advisersStage = async () => {
    const status = await getPipelineStatus(new Date("2026-09-06T00:00:00Z"));
    return status.stages.find((stage) => stage.id === "advisers");
  };

  it("names the newest snapshot on file", async () => {
    const repo = globalServiceRegistry.get(ADV_ADVISER_REPOSITORY_TOKEN);
    await repo.put(adviser("2011-2024", "110001"));
    await repo.put(adviser("2026-07", "110002"));
    await repo.put(adviser("2026-06", "110003"));

    expect((await advisersStage())?.summary).toContain("2026-07");
  });

  it("asks the backend for one row rather than streaming the table", async () => {
    const repo = globalServiceRegistry.get(ADV_ADVISER_REPOSITORY_TOKEN);
    await repo.put(adviser("2026-07", "110002"));
    const records = vi.spyOn(repo, "records");

    await advisersStage();

    // `snapshot` leads the primary key, so one ordered row answers this. Bare
    // `sec` runs `status`, and streaming ~10^6 advisers to keep a running
    // string maximum was the cost of every invocation after an ADV load.
    expect(records).not.toHaveBeenCalled();
  });

  it("says nothing about a snapshot when no adviser has been loaded", async () => {
    const stage = await advisersStage();

    expect(stage?.empty).toBe(true);
    expect(stage?.summary).toBe("none");
  });
});
