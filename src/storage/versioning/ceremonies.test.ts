/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { dropNext, dropPrevious, promote, rollback, startDev } from "./ceremonies";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "./ComponentVersionSchema";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "./ExtractorRunSchema";
import { ExtractorRunRepo } from "./ExtractorRunRepo";
import { VersionEventRepo } from "./VersionEventRepo";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "./VersionEventSchema";
import { VersionRegistry } from "./VersionRegistry";
import { PersonIdentityLinkRepo } from "../canonical/PersonIdentityLinkRepo";
import { CanonicalPersonRepo } from "../canonical/CanonicalPersonRepo";
import { clearResolverExtensionsForTesting } from "../../resolver/resolverExtensions";
import { registerSecResolvers } from "../../config/registerResolvers";

function buildDeps() {
  const reg = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const events = new VersionEventRepo(
    globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN)
  );
  const runs = new ExtractorRunRepo(
    globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
  );
  return { reg, events, runs };
}

describe("ceremonies.startDev", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("major bump populates next slot and captures target_count", async () => {
    const { reg, events } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 42,
      notes: "first major dev cycle",
    });
    const next = await reg.getNext("extractor", "D");
    expect(next?.semver).toBe("2.0.0");
    expect(next?.bump_type).toBe("major");
    expect(next?.target_count).toBe(42);
    expect(next?.coverage_complete).toBe(false);

    const evts = await events.listForComponent("extractor", "D");
    expect(evts).toHaveLength(1);
    expect(evts[0].event_type).toBe("start-dev");
    expect(evts[0].from_semver).toBe("1.0.0");
    expect(evts[0].to_semver).toBe("2.0.0");
    expect(evts[0].bump_type).toBe("major");
    expect(evts[0].target_count).toBe(42);
    expect(evts[0].notes).toBe("first major dev cycle");
  });

  it("minor bump populates next slot with null target_count", async () => {
    const { reg, events } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "1.1.0",
      bump: "minor",
      targetCount: null,
      notes: null,
    });
    const next = await reg.getNext("extractor", "D");
    expect(next?.semver).toBe("1.1.0");
    expect(next?.bump_type).toBe("minor");
    expect(next?.target_count).toBeNull();
  });

  it("patch bump updates current in place; no next slot created", async () => {
    const { reg, events } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "1.0.1",
      bump: "patch",
      targetCount: null,
      notes: null,
    });
    const current = await reg.getCurrent("extractor", "D");
    expect(current?.semver).toBe("1.0.1");
    const next = await reg.getNext("extractor", "D");
    expect(next).toBeUndefined();

    const evts = await events.listForComponent("extractor", "D");
    expect(evts).toHaveLength(1);
    expect(evts[0].event_type).toBe("promote");
    expect(evts[0].bump_type).toBe("patch");
    expect(evts[0].from_semver).toBe("1.0.0");
    expect(evts[0].to_semver).toBe("1.0.1");
  });

  it("rejects start-dev when next already exists", async () => {
    const { reg, events } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 42,
      notes: null,
    });
    await expect(
      startDev({
        reg,
        events,
        kind: "extractor",
        id: "D",
        semver: "3.0.0",
        bump: "major",
        targetCount: 50,
        notes: null,
      })
    ).rejects.toThrow(/next slot already exists.*drop-next/i);
  });

  it("rejects patch start-dev when next slot already exists", async () => {
    const { reg, events } = buildDeps();
    // Start a major dev cycle in flight.
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 42,
      notes: null,
    });
    // Now try a patch — should be rejected.
    await expect(
      startDev({
        reg,
        events,
        kind: "extractor",
        id: "D",
        semver: "1.0.1",
        bump: "patch",
        targetCount: null,
        notes: null,
      })
    ).rejects.toThrow(/next slot already exists.*drop-next/i);
  });

  it("rejects start-dev with invalid bump progression", async () => {
    const { reg, events } = buildDeps();
    // current is 1.0.0; major bump must go to 2.0.0, not 2.1.0
    await expect(
      startDev({
        reg,
        events,
        kind: "extractor",
        id: "D",
        semver: "2.1.0",
        bump: "major",
        targetCount: 42,
        notes: null,
      })
    ).rejects.toThrow(/reset minor/i);
  });

  it("rejects start-dev for unregistered component", async () => {
    const { reg, events } = buildDeps();
    await expect(
      startDev({
        reg,
        events,
        kind: "extractor",
        id: "no-such-form",
        semver: "1.0.0",
        bump: "major",
        targetCount: 0,
        notes: null,
      })
    ).rejects.toThrow(/no extractor registered/i);
  });

  it("dry-run validates inputs but does not write", async () => {
    const { reg, events } = buildDeps();

    // Invalid bump progression should still throw even with dryRun.
    await expect(
      startDev({
        reg,
        events,
        kind: "extractor",
        id: "D",
        semver: "2.1.0", // major bump can't reset to .1
        bump: "major",
        targetCount: 0,
        notes: null,
        dryRun: true,
      })
    ).rejects.toThrow(/reset minor/i);

    // Valid input with dryRun=true should NOT write the next slot or log.
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 0,
      notes: "dry run",
      dryRun: true,
    });
    expect(await reg.getNext("extractor", "D")).toBeUndefined();
    const evts = await events.listForComponent("extractor", "D");
    expect(evts).toHaveLength(0);
  });
});

describe("ceremonies.promote", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("rotates slots: current → previous, next → current", async () => {
    const { reg, events, runs } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 1, // one filing to satisfy the gate
      notes: null,
    });
    // Seed one successful run at 2.0.0 to satisfy the major gate.
    await runs.recordRun({
      cik: 1234567,
      accession_number: "0001234567-25-000001",
      form: "D",
      extractor_id: "D",
      extractor_version: "2.0.0",
      slot_at_run: "next",
      success: true,
      error: null,
    });

    await promote({
      reg,
      events,
      runs,
      kind: "extractor",
      id: "D",
      force: false,
      notes: null,
    });

    expect((await reg.getCurrent("extractor", "D"))?.semver).toBe("2.0.0");
    expect((await reg.getPrevious("extractor", "D"))?.semver).toBe("1.0.0");
    expect(await reg.getNext("extractor", "D")).toBeUndefined();
  });

  it("major-promote with insufficient coverage rejects without --force", async () => {
    const { reg, events, runs } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 100,
      notes: null,
    });
    // Only 1 successful run vs target_count of 100.
    await runs.recordRun({
      cik: 1234567,
      accession_number: "0001234567-25-000001",
      form: "D",
      extractor_id: "D",
      extractor_version: "2.0.0",
      slot_at_run: "next",
      success: true,
      error: null,
    });

    await expect(
      promote({
        reg,
        events,
        runs,
        kind: "extractor",
        id: "D",
        force: false,
        notes: null,
      })
    ).rejects.toThrow(/coverage.*1\/100/i);
  });

  it("major-promote with --force overrides coverage gate", async () => {
    const { reg, events, runs } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 100,
      notes: null,
    });
    await promote({
      reg,
      events,
      runs,
      kind: "extractor",
      id: "D",
      force: true,
      notes: "force-promoting with 0/100 for testing",
    });
    expect((await reg.getCurrent("extractor", "D"))?.semver).toBe("2.0.0");
  });

  it("minor-promote has no coverage gate", async () => {
    const { reg, events, runs } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "1.1.0",
      bump: "minor",
      targetCount: null,
      notes: null,
    });
    await promote({
      reg,
      events,
      runs,
      kind: "extractor",
      id: "D",
      force: false,
      notes: null,
    });
    expect((await reg.getCurrent("extractor", "D"))?.semver).toBe("1.1.0");
  });

  it("dry-run validates but writes nothing", async () => {
    const { reg, events, runs } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 0,
      notes: null,
    });
    const beforeEvents = await events.listForComponent("extractor", "D");

    await promote({
      reg,
      events,
      runs,
      kind: "extractor",
      id: "D",
      force: true,
      notes: null,
      dryRun: true,
    });

    // No slot rotation.
    expect((await reg.getCurrent("extractor", "D"))?.semver).toBe("1.0.0");
    expect((await reg.getNext("extractor", "D"))?.semver).toBe("2.0.0");
    expect(await reg.getPrevious("extractor", "D")).toBeUndefined();
    // No new event logged.
    const afterEvents = await events.listForComponent("extractor", "D");
    expect(afterEvents).toHaveLength(beforeEvents.length);
  });

  it("dry-run promote still throws on missing next slot", async () => {
    const { reg, events, runs } = buildDeps();
    await expect(
      promote({
        reg,
        events,
        runs,
        kind: "extractor",
        id: "D",
        force: false,
        notes: null,
        dryRun: true,
      })
    ).rejects.toThrow(/no next slot/i);
  });

  it("after promote, getActiveSlot returns the new current (not the next that was promoted)", async () => {
    const { reg, events, runs } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 0,
      notes: null,
    });

    // Before promote: getActiveSlot should return next.
    const { getActiveSlot } = await import("./getActiveSlot");
    const beforePromote = await getActiveSlot(reg, "extractor", "D");
    expect(beforePromote).toEqual({ slot: "next", semver: "2.0.0" });

    await promote({
      reg,
      events,
      runs,
      kind: "extractor",
      id: "D",
      force: true,
      notes: null,
    });

    // After promote: next is empty, so getActiveSlot returns current at 2.0.0.
    const afterPromote = await getActiveSlot(reg, "extractor", "D");
    expect(afterPromote).toEqual({ slot: "current", semver: "2.0.0" });
  });
});

describe("ceremonies.rollback", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("swaps current and previous slots", async () => {
    const { reg, events, runs } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 0,
      notes: null,
    });
    await promote({
      reg,
      events,
      runs,
      kind: "extractor",
      id: "D",
      force: true,
      notes: null,
    });
    // Now current=2.0.0, previous=1.0.0. Roll back.
    await rollback({
      reg,
      events,
      kind: "extractor",
      id: "D",
      notes: null,
    });
    expect((await reg.getCurrent("extractor", "D"))?.semver).toBe("1.0.0");
    expect((await reg.getPrevious("extractor", "D"))?.semver).toBe("2.0.0");
  });

  it("rejects rollback when no previous slot exists", async () => {
    const { reg, events } = buildDeps();
    await expect(
      rollback({
        reg,
        events,
        kind: "extractor",
        id: "D",
        notes: null,
      })
    ).rejects.toThrow(/no previous slot/i);
  });

  it("dry-run validates but writes nothing", async () => {
    const { reg, events, runs } = buildDeps();
    // Set up: start-dev → promote → so previous=1.0.0, current=2.0.0.
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 0,
      notes: null,
    });
    await promote({
      reg,
      events,
      runs,
      kind: "extractor",
      id: "D",
      force: true,
      notes: null,
    });
    const beforeEvents = await events.listForComponent("extractor", "D");

    await rollback({
      reg,
      events,
      kind: "extractor",
      id: "D",
      notes: null,
      dryRun: true,
    });

    // Slots unchanged.
    expect((await reg.getCurrent("extractor", "D"))?.semver).toBe("2.0.0");
    expect((await reg.getPrevious("extractor", "D"))?.semver).toBe("1.0.0");
    // No new event.
    const afterEvents = await events.listForComponent("extractor", "D");
    expect(afterEvents).toHaveLength(beforeEvents.length);
  });
});

describe("ceremonies.dropNext", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("clears the next slot", async () => {
    const { reg, events } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 0,
      notes: null,
    });
    await dropNext({
      reg,
      events,
      kind: "extractor",
      id: "D",
      notes: "abandoned",
    });
    expect(await reg.getNext("extractor", "D")).toBeUndefined();

    const evts = await events.listForComponent("extractor", "D");
    expect(evts[0].event_type).toBe("drop-next");
    expect(evts[0].notes).toBe("abandoned");
  });

  it("rejects drop-next when no next slot exists", async () => {
    const { reg, events } = buildDeps();
    await expect(
      dropNext({
        reg,
        events,
        kind: "extractor",
        id: "D",
        notes: null,
      })
    ).rejects.toThrow(/no next slot/i);
  });

  it("dry-run validates but writes nothing", async () => {
    const { reg, events } = buildDeps();
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 0,
      notes: null,
    });
    const beforeEvents = await events.listForComponent("extractor", "D");

    await dropNext({
      reg,
      events,
      kind: "extractor",
      id: "D",
      notes: null,
      dryRun: true,
    });

    // Next slot unchanged.
    expect((await reg.getNext("extractor", "D"))?.semver).toBe("2.0.0");
    // No new event.
    const afterEvents = await events.listForComponent("extractor", "D");
    expect(afterEvents).toHaveLength(beforeEvents.length);
  });
});

describe("ceremonies.dropPrevious", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    // Register resolver kinds before setupAllDatabases so its
    // bootstrapComponentVersions() seeds the resolver current slots too.
    clearResolverExtensionsForTesting();
    registerSecResolvers();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
    clearResolverExtensionsForTesting();
  });

  it("throws when no previous slot exists", async () => {
    const { reg, events } = buildDeps();
    // After bootstrapping, resolver:person only has current@1.0.0 — no previous.
    await expect(
      dropPrevious({
        reg,
        events,
        kind: "resolver",
        id: "person",
        notes: null,
      })
    ).rejects.toThrow(/no previous slot/i);
  });

  it("dropPrevious(resolver, person) clears identity-link and canonical rows", async () => {
    const { reg, events } = buildDeps();

    // Seed previous@1.0.0 slot for resolver:person by doing start-dev → promote.
    await startDev({
      reg,
      events,
      kind: "resolver",
      id: "person",
      semver: "2.0.0",
      bump: "major",
      targetCount: 0,
      notes: null,
    });
    await promote({
      reg,
      events,
      runs: buildDeps().runs,
      kind: "resolver",
      id: "person",
      force: true,
      notes: null,
    });
    // Now: current=2.0.0, previous=1.0.0

    // Seed a canonical person and identity link at 1.0.0.
    const canonRepo = new CanonicalPersonRepo();
    const linkRepo = new PersonIdentityLinkRepo();

    const canonId = "00000000-0000-0000-0000-000000000001";
    await canonRepo.create({
      canonical_person_id: canonId,
      resolver_version: "1.0.0",
      display_first: "Alice",
      display_middle: null,
      display_last: "Smith",
      display_suffix: null,
      cik: null,
      normalized_first: "alice",
      normalized_middle: null,
      normalized_last: "smith",
      normalized_suffix: null,
      source_filing_issuer_cik: null,
      created_at: new Date().toISOString(),
    });
    await linkRepo.upsert(
      /* observation_id */ 42,
      /* resolver_version */ "1.0.0",
      /* canonical_person_id */ canonId
    );

    // Verify seed is in place.
    expect(await canonRepo.listForResolverVersion("1.0.0")).toHaveLength(1);
    expect(await linkRepo.listForCanonical(canonId, "1.0.0")).toHaveLength(1);
    expect((await reg.getPrevious("resolver", "person"))?.semver).toBe("1.0.0");

    // Execute.
    await dropPrevious({
      reg,
      events,
      kind: "resolver",
      id: "person",
      notes: "cleaning up 1.0.0",
    });

    // Identity link must be gone.
    expect(await linkRepo.listForCanonical(canonId, "1.0.0")).toHaveLength(0);
    // Canonical row must be deleted (no remaining links).
    expect(await canonRepo.listForResolverVersion("1.0.0")).toHaveLength(0);
    // Previous slot must be cleared.
    expect(await reg.getPrevious("resolver", "person")).toBeUndefined();

    // Event logged.
    const evts = await events.listForComponent("resolver", "person");
    const dropEvt = evts.find((e) => e.event_type === "drop-previous");
    expect(dropEvt).toBeDefined();
    expect(dropEvt?.from_semver).toBe("1.0.0");
    expect(dropEvt?.notes).toBe("cleaning up 1.0.0");
  });

  it("dropPrevious(extractor) deletes run rows at previous semver", async () => {
    const { reg, events, runs } = buildDeps();

    // Seed previous@1.0.0 for extractor:D by doing start-dev → promote.
    await startDev({
      reg,
      events,
      kind: "extractor",
      id: "D",
      semver: "2.0.0",
      bump: "major",
      targetCount: 0,
      notes: null,
    });
    await promote({
      reg,
      events,
      runs,
      kind: "extractor",
      id: "D",
      force: true,
      notes: null,
    });
    // Now: current=2.0.0, previous=1.0.0

    // Seed an extractor run at 1.0.0.
    await runs.recordRun({
      cik: 9999999,
      accession_number: "0009999999-25-000001",
      form: "D",
      extractor_id: "D",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: true,
      error: null,
    });

    // Verify seed.
    expect((await reg.getPrevious("extractor", "D"))?.semver).toBe("1.0.0");

    // Execute.
    await dropPrevious({
      reg,
      events,
      runs,
      kind: "extractor",
      id: "D",
      notes: null,
    });

    // Run row must be gone.
    const runAfter = await runs.findRun(9999999, "0009999999-25-000001", "D", "1.0.0");
    expect(runAfter).toBeUndefined();
    // Previous slot must be cleared.
    expect(await reg.getPrevious("extractor", "D")).toBeUndefined();

    // Event logged.
    const evts = await events.listForComponent("extractor", "D");
    const dropEvt = evts.find((e) => e.event_type === "drop-previous");
    expect(dropEvt).toBeDefined();
    expect(dropEvt?.from_semver).toBe("1.0.0");
  });
});
