/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { bootstrapExtractorVersions } from "./bootstrapExtractorVersions";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "./ComponentVersionSchema";
import { EXTRACTOR_IDS } from "./extractorIds";
import { VersionRegistry } from "./VersionRegistry";

describe("bootstrapExtractorVersions", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("seeds every known extractor at 1.0.0 in the current slot", async () => {
    await bootstrapExtractorVersions();
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    for (const id of EXTRACTOR_IDS) {
      const cur = await reg.getCurrent("extractor", id);
      expect(cur?.semver).toBe("1.0.0");
      expect(cur?.coverage_complete).toBe(true);
      expect(cur?.bump_type).toBeNull();
    }
  });

  it("is idempotent: running it twice does not change anything", async () => {
    await bootstrapExtractorVersions();
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    const before = await reg.getCurrent("extractor", "D");

    await bootstrapExtractorVersions();
    const after = await reg.getCurrent("extractor", "D");

    expect(after?.semver).toBe(before?.semver);
    expect(after?.started_at).toBe(before?.started_at);
  });

  it("does not overwrite a manually-advanced current slot", async () => {
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "current",
      semver: "2.5.0",
      bump_type: null,
      started_at: "2026-05-22T00:00:00Z",
      coverage_complete: true,
      target_count: null,
    });

    await bootstrapExtractorVersions();

    const cur = await reg.getCurrent("extractor", "D");
    expect(cur?.semver).toBe("2.5.0");
  });

  it("leaves previous and next slots empty", async () => {
    await bootstrapExtractorVersions();
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    expect(await reg.getPrevious("extractor", "D")).toBeUndefined();
    expect(await reg.getNext("extractor", "D")).toBeUndefined();
  });
});
