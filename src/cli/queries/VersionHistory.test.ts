/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { VersionEventRepo } from "../../storage/versioning/VersionEventRepo";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "../../storage/versioning/VersionEventSchema";
import { getVersionHistory } from "./VersionHistory";

describe("getVersionHistory", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("returns empty when no events recorded for the component", async () => {
    const events = await getVersionHistory("extractor", "D");
    expect(events).toEqual([]);
  });

  it("returns events newest-first for the component", async () => {
    const repo = new VersionEventRepo(globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN));
    await repo.recordEvent({
      component_kind: "extractor",
      component_id: "D",
      event_type: "start-dev",
      from_semver: "1.0.0",
      to_semver: "2.0.0",
      bump_type: "major",
      target_count: 100,
      notes: null,
    });
    await new Promise((r) => setTimeout(r, 5));
    await repo.recordEvent({
      component_kind: "extractor",
      component_id: "D",
      event_type: "promote",
      from_semver: "1.0.0",
      to_semver: "2.0.0",
      bump_type: "major",
      target_count: null,
      notes: null,
    });

    const events = await getVersionHistory("extractor", "D");
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe("promote");
    expect(events[1].event_type).toBe("start-dev");
  });

  it("honors the limit parameter", async () => {
    const repo = new VersionEventRepo(globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN));
    for (let i = 0; i < 5; i++) {
      await repo.recordEvent({
        component_kind: "extractor",
        component_id: "D",
        event_type: "drop-next",
        from_semver: `2.0.${i}`,
        to_semver: null,
        bump_type: "major",
        target_count: null,
        notes: null,
      });
      await new Promise((r) => setTimeout(r, 2));
    }
    const limited = await getVersionHistory("extractor", "D", 2);
    expect(limited).toHaveLength(2);
  });

  it("filters by component (kind, id)", async () => {
    const repo = new VersionEventRepo(globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN));
    await repo.recordEvent({
      component_kind: "extractor",
      component_id: "D",
      event_type: "start-dev",
      from_semver: "1.0.0",
      to_semver: "2.0.0",
      bump_type: "major",
      target_count: 100,
      notes: null,
    });
    await repo.recordEvent({
      component_kind: "extractor",
      component_id: "C",
      event_type: "start-dev",
      from_semver: "1.0.0",
      to_semver: "2.0.0",
      bump_type: "major",
      target_count: 50,
      notes: null,
    });

    const dEvents = await getVersionHistory("extractor", "D");
    expect(dEvents).toHaveLength(1);
    expect(dEvents[0].component_id).toBe("D");
  });
});
