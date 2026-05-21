/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
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
    expect(await reg.getCurrent("extractor", "D")).toBeUndefined();
    expect(await reg.getPrevious("extractor", "D")).toBeUndefined();
    expect(await reg.getNext("extractor", "D")).toBeUndefined();
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
    });
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "current",
      semver: "2.0.0",
      bump_type: "major",
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: true,
    });
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "next",
      semver: "2.1.0",
      bump_type: "minor",
      started_at: "2026-05-21T01:00:00Z",
      coverage_complete: false,
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
    });
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "next",
      semver: "2.1.0",
      bump_type: "minor",
      started_at: "2026-05-21T01:00:00Z",
      coverage_complete: false,
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
      component_id: "D",
      slot: "current",
      semver: "1.0.0",
      bump_type: null,
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: true,
    });
    await reg.putSlot({
      component_kind: "resolver",
      component_id: "person",
      slot: "current",
      semver: "1.0.0",
      bump_type: null,
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: true,
    });

    const all = await reg.listAll();
    expect(all).toHaveLength(2);
    const kinds = all.map((r) => r.component_kind).sort();
    expect(kinds).toEqual(["extractor", "resolver"]);
  });

  it("listByKind filters", async () => {
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
    });
    await reg.putSlot({
      component_kind: "resolver",
      component_id: "person",
      slot: "current",
      semver: "1.0.0",
      bump_type: null,
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: true,
    });

    const extractors = await reg.listByKind("extractor");
    expect(extractors).toHaveLength(1);
    expect(extractors[0].component_id).toBe("D");
  });
});
