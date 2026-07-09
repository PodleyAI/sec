/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "./ComponentVersionSchema";
import { getActiveSlot } from "./getActiveSlot";
import { VersionRegistry } from "./VersionRegistry";

describe("getActiveSlot", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("returns the current slot when only current exists", async () => {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    // setupAllDatabases bootstraps extractor:D at 1.0.0 in current.
    const active = await getActiveSlot(reg, "extractor", "D");
    expect(active).toEqual({ slot: "current", semver: "1.0.0" });
  });

  it("returns the next slot when next exists, regardless of bump type", async () => {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    await reg.putSlot({
      component_kind: "extractor",
      component_id: "D",
      slot: "next",
      semver: "2.0.0",
      bump_type: "major",
      started_at: "2026-05-21T00:00:00Z",
      coverage_complete: false,
      target_count: 100,
    });
    const active = await getActiveSlot(reg, "extractor", "D");
    expect(active).toEqual({ slot: "next", semver: "2.0.0" });
  });

  it("returns undefined when neither slot exists", async () => {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    const active = await getActiveSlot(reg, "extractor", "no-such-extractor");
    expect(active).toBeUndefined();
  });
});
