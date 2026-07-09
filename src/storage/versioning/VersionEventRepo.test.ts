/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { VersionEventRepo } from "./VersionEventRepo";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "./VersionEventSchema";

describe("VersionEventRepo", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("recordEvent then listForComponent round-trips", async () => {
    const repo = new VersionEventRepo(
      globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN)
    );
    await repo.recordEvent({
      component_kind: "extractor",
      component_id: "D",
      event_type: "start-dev",
      from_semver: "1.0.0",
      to_semver: "2.0.0",
      bump_type: "major",
      target_count: 1234,
      notes: "first dev cycle",
    });

    const events = await repo.listForComponent("extractor", "D");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("start-dev");
    expect(events[0].from_semver).toBe("1.0.0");
    expect(events[0].to_semver).toBe("2.0.0");
    expect(events[0].bump_type).toBe("major");
    expect(events[0].target_count).toBe(1234);
    expect(events[0].notes).toBe("first dev cycle");
    expect(events[0].at_timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("listForComponent returns events ordered newest first", async () => {
    const repo = new VersionEventRepo(
      globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN)
    );
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

    const events = await repo.listForComponent("extractor", "D");
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe("promote");
    expect(events[1].event_type).toBe("start-dev");
  });

  it("listForComponent filters by (kind, id)", async () => {
    const repo = new VersionEventRepo(
      globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN)
    );
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

    const dEvents = await repo.listForComponent("extractor", "D");
    expect(dEvents).toHaveLength(1);
    expect(dEvents[0].component_id).toBe("D");
  });

  it("listForComponent honors the limit parameter", async () => {
    const repo = new VersionEventRepo(
      globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN)
    );
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
    const limited = await repo.listForComponent("extractor", "D", 3);
    expect(limited).toHaveLength(3);
  });
});
