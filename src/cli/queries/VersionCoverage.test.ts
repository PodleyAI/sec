/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { getVersionCoverage } from "./VersionCoverage";

describe("getVersionCoverage", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("returns 'no dev cycle in flight' when no next slot exists", async () => {
    const result = await getVersionCoverage("extractor", "D");
    expect(result.status).toBe("no dev cycle in flight");
    expect(result.next_semver).toBeNull();
    expect(result.target_count).toBeNull();
    expect(result.successful_count).toBeNull();
    expect(result.percent).toBeNull();
  });

  it("returns 'no coverage gate' when next slot has minor bump", async () => {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "next",
      semver: "1.1.0",
      bump_type: "minor",
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: false,
      target_count: null,
    });
    const result = await getVersionCoverage("extractor", "D");
    expect(result.status).toBe("no coverage gate (bump_type=minor)");
    expect(result.next_semver).toBe("1.1.0");
    expect(result.target_count).toBeNull();
  });

  it("returns 'in progress' when major bump has incomplete coverage", async () => {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    const runs = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "next",
      semver: "2.0.0",
      bump_type: "major",
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: false,
      target_count: 4,
    });
    // 2 successful out of 4 target.
    for (let i = 0; i < 2; i++) {
      await runs.recordRun({
        cik: 1000000 + i,
        accession_number: `0001000000-25-00000${i}`,
        form: "D",
        extractor_id: "D",
        extractor_version: "2.0.0",
        slot_at_run: "next",
        success: true,
        error: null,
      });
    }

    const result = await getVersionCoverage("extractor", "D");
    expect(result.status).toBe("in progress");
    expect(result.target_count).toBe(4);
    expect(result.successful_count).toBe(2);
    expect(result.percent).toBe(50);
  });

  it("returns 'ready to promote' when successful >= target", async () => {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    const runs = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "next",
      semver: "2.0.0",
      bump_type: "major",
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: false,
      target_count: 2,
    });
    for (let i = 0; i < 2; i++) {
      await runs.recordRun({
        cik: 1000000 + i,
        accession_number: `0001000000-25-00000${i}`,
        form: "D",
        extractor_id: "D",
        extractor_version: "2.0.0",
        slot_at_run: "next",
        success: true,
        error: null,
      });
    }
    const result = await getVersionCoverage("extractor", "D");
    expect(result.status).toBe("ready to promote");
    expect(result.percent).toBe(100);
  });

  it("returns 'ready to promote (target_count=0)' when target is zero", async () => {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "next",
      semver: "2.0.0",
      bump_type: "major",
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: false,
      target_count: 0,
    });
    const result = await getVersionCoverage("extractor", "D");
    expect(result.status).toBe("ready to promote (target_count=0)");
    expect(result.percent).toBe(100);
  });
});
