/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "./ComponentVersionSchema";
import { isValidSemver, VersionRegistry } from "./VersionRegistry";

describe("isValidSemver", () => {
  it("accepts standard semver", () => {
    expect(isValidSemver("1.0.0")).toBe(true);
    expect(isValidSemver("2.10.3")).toBe(true);
    expect(isValidSemver("0.0.1")).toBe(true);
  });
  it("rejects malformed strings", () => {
    expect(isValidSemver("1.0")).toBe(false);
    expect(isValidSemver("v1.0.0")).toBe(false);
    expect(isValidSemver("1.0.0-alpha")).toBe(false); // intentionally not supported in v1
    expect(isValidSemver("")).toBe(false);
    expect(isValidSemver("foo")).toBe(false);
  });
});

describe("VersionRegistry", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("returns undefined for missing slots", async () => {
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    expect(await reg.getCurrent("extractor", "unbootstrapped-form")).toBeUndefined();
    expect(await reg.getPrevious("extractor", "unbootstrapped-form")).toBeUndefined();
    expect(await reg.getNext("extractor", "unbootstrapped-form")).toBeUndefined();
  });

  it("round-trips a single slot via putSlot/getCurrent", async () => {
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "current",
      semver: "1.0.0",
      bump_type: null,
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: true,
      target_count: null,
    });
    const cur = await reg.getCurrent("extractor", "D");
    expect(cur?.semver).toBe("1.0.0");
    expect(cur?.coverage_complete).toBe(true);
    expect(await reg.getPrevious("extractor", "D")).toBeUndefined();
    expect(await reg.getNext("extractor", "D")).toBeUndefined();
  });

  it("keeps slots independent for the same component", async () => {
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "previous",
      semver: "1.0.0",
      bump_type: null,
      started_at: "2026-05-20T00:00:00Z",
      coverage_complete: true,
      target_count: null,
    });
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "current",
      semver: "2.0.0",
      bump_type: "major",
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: true,
      target_count: null,
    });
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "next",
      semver: "2.1.0",
      bump_type: "minor",
      started_at: "2026-05-21T01:00:00Z",
      coverage_complete: false,
      target_count: null,
    });

    expect((await reg.getPrevious("extractor", "D"))?.semver).toBe("1.0.0");
    expect((await reg.getCurrent("extractor", "D"))?.semver).toBe("2.0.0");
    expect((await reg.getNext("extractor", "D"))?.semver).toBe("2.1.0");
  });

  it("clearSlot removes only the targeted slot", async () => {
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "current",
      semver: "2.0.0",
      bump_type: null,
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: true,
      target_count: null,
    });
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "next",
      semver: "2.1.0",
      bump_type: "minor",
      started_at: "2026-05-21T01:00:00Z",
      coverage_complete: false,
      target_count: null,
    });

    await reg.clearSlot("extractor", "D", "next");

    expect(await reg.getNext("extractor", "D")).toBeUndefined();
    expect((await reg.getCurrent("extractor", "D"))?.semver).toBe("2.0.0");
  });

  it("listAll returns rows across kinds and ids", async () => {
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "test-extractor",
      slot: "current",
      semver: "1.0.0",
      bump_type: null,
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: true,
      target_count: null,
    });
    await reg.putSlot({
      component_kind: "resolver",
      component_id: "test-resolver",
      slot: "current",
      semver: "1.0.0",
      bump_type: null,
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: true,
      target_count: null,
    });

    const all = await reg.listAll();
    const testRows = all.filter(
      (r) => r.component_id === "test-extractor" || r.component_id === "test-resolver"
    );
    expect(testRows).toHaveLength(2);
    const kinds = testRows.map((r) => r.component_kind).sort();
    expect(kinds).toEqual(["extractor", "resolver"]);
  });

  it("listByKind filters", async () => {
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "test-extractor",
      slot: "current",
      semver: "1.0.0",
      bump_type: null,
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: true,
      target_count: null,
    });
    await reg.putSlot({
      component_kind: "resolver",
      component_id: "test-resolver",
      slot: "current",
      semver: "1.0.0",
      bump_type: null,
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: true,
      target_count: null,
    });

    const extractors = await reg.listByKind("extractor");
    const testExtractors = extractors.filter((r) => r.component_id === "test-extractor");
    expect(testExtractors).toHaveLength(1);
    expect(testExtractors[0].component_id).toBe("test-extractor");
    // And the bootstrap rows are also there
    expect(extractors.length).toBeGreaterThanOrEqual(6); // 5 bootstrapped + 1 test
  });

  it("rejects putSlot with malformed semver", async () => {
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    await expect(
      reg.putSlot({
        component_kind: "extractor",
        component_id: "D",
        slot: "current",
        semver: "not-a-version",
        bump_type: null,
        started_at: "2026-05-21T00:00:00Z",
        coverage_complete: true,
        target_count: null,
      })
    ).rejects.toThrow(/invalid semver/);
  });

  it("rejects putSlot when current slot has coverage_complete=false", async () => {
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    await expect(
      reg.putSlot({
        component_kind: "extractor",
        component_id: "D",
        slot: "current",
        semver: "1.0.0",
        bump_type: null,
        started_at: "2026-05-21T00:00:00Z",
        coverage_complete: false,
        target_count: null,
      })
    ).rejects.toThrow(/coverage_complete must be true/);
  });

  it("allows putSlot for next slot with coverage_complete=false", async () => {
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "next",
      semver: "2.1.0",
      bump_type: "minor",
      started_at: "2026-05-21T01:00:00Z",
      coverage_complete: false,
      target_count: null,
    });
    expect((await reg.getNext("extractor", "D"))?.coverage_complete).toBe(false);
  });

  it("putSlot overwrites the same slot on second call", async () => {
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "current",
      semver: "1.0.0",
      bump_type: null,
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: true,
      target_count: null,
    });
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "current",
      semver: "1.0.1",
      bump_type: "patch",
      started_at: "2026-05-21T02:00:00Z",
      coverage_complete: true,
      target_count: null,
    });
    const row = await reg.getCurrent("extractor", "D");
    expect(row?.semver).toBe("1.0.1");
    expect(row?.bump_type).toBe("patch");
  });

  it("clearSlot on a slot that doesn't exist is a no-op", async () => {
    const reg = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    // Should not throw
    await reg.clearSlot("extractor", "D", "next");
    expect(await reg.getNext("extractor", "D")).toBeUndefined();
  });
});
