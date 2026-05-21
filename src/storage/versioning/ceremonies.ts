/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BumpType, ComponentKind } from "./ComponentVersionSchema";
import { isRegisteredComponent } from "./componentRegistry";
import type { ExtractorRunRepo } from "./ExtractorRunRepo";
import { validateBumpProgression } from "./semver";
import type { VersionEventRepo } from "./VersionEventRepo";
import type { VersionRegistry } from "./VersionRegistry";

interface BaseArgs {
  readonly reg: VersionRegistry;
  readonly events: VersionEventRepo;
  readonly kind: ComponentKind;
  readonly id: string;
}

export interface StartDevArgs extends BaseArgs {
  readonly semver: string;
  readonly bump: BumpType;
  /** Required for major bumps (the snapshot count); null for minor/patch. */
  readonly targetCount: number | null;
  readonly notes: string | null;
}

export interface PromoteArgs extends BaseArgs {
  readonly runs: ExtractorRunRepo;
  readonly force: boolean;
  readonly notes: string | null;
}

export interface RollbackArgs extends BaseArgs {
  readonly notes: string | null;
}

export interface DropNextArgs extends BaseArgs {
  readonly notes: string | null;
}

function assertRegistered(kind: ComponentKind, id: string): void {
  if (!isRegisteredComponent(kind, id)) {
    throw new Error(`No ${kind} registered: '${id}'`);
  }
}

export async function startDev(args: StartDevArgs): Promise<void> {
  const { reg, events, kind, id, semver, bump, targetCount, notes } = args;
  assertRegistered(kind, id);

  const current = await reg.getCurrent(kind, id);
  if (!current) {
    throw new Error(
      `No current slot for ${kind} '${id}'. Run 'sec db setup' to bootstrap.`
    );
  }

  // For major/minor bumps, reject if a next slot already exists BEFORE
  // validating progression. (The progression check uses current.semver as
  // the base; if next exists, the user has likely already moved on and the
  // caller should drop-next first regardless of the proposed semver.)
  if (bump !== "patch") {
    const existingNext = await reg.getNext(kind, id);
    if (existingNext) {
      throw new Error(
        `next slot already exists for ${kind} '${id}' (at ${existingNext.semver}). drop-next first.`
      );
    }
  }

  const progressionError = validateBumpProgression(current.semver, semver, bump);
  if (progressionError) throw new Error(progressionError);

  if (bump === "patch") {
    // No next slot. Update current in place; log a single "promote" event.
    const fromSemver = current.semver;
    const startedAt = new Date().toISOString();
    await reg.putSlot({
      ...current,
      semver,
      started_at: startedAt,
      bump_type: "patch",
      target_count: null,
    });
    await events.recordEvent({
      component_kind: kind,
      component_id: id,
      event_type: "promote",
      from_semver: fromSemver,
      to_semver: semver,
      bump_type: "patch",
      target_count: null,
      notes,
    });
    return;
  }

  // Major or minor: populate next slot.
  const existingNext = await reg.getNext(kind, id);
  if (existingNext) {
    throw new Error(
      `next slot already exists for ${kind} '${id}' (at ${existingNext.semver}). drop-next first.`
    );
  }

  if (bump === "major" && (targetCount === null || targetCount < 0)) {
    throw new Error(
      `major bump requires non-negative targetCount (got ${targetCount})`
    );
  }

  await reg.putSlot({
    component_kind: kind,
    component_id: id,
    slot: "next",
    semver,
    bump_type: bump,
    started_at: new Date().toISOString(),
    coverage_complete: false,
    target_count: bump === "major" ? targetCount : null,
  });

  await events.recordEvent({
    component_kind: kind,
    component_id: id,
    event_type: "start-dev",
    from_semver: current.semver,
    to_semver: semver,
    bump_type: bump,
    target_count: bump === "major" ? targetCount : null,
    notes,
  });
}

export async function promote(args: PromoteArgs): Promise<void> {
  const { reg, events, runs, kind, id, force, notes } = args;
  assertRegistered(kind, id);

  const next = await reg.getNext(kind, id);
  if (!next) throw new Error(`No next slot for ${kind} '${id}'. Nothing to promote.`);

  const current = await reg.getCurrent(kind, id);
  if (!current) throw new Error(`No current slot for ${kind} '${id}'.`);

  // Major coverage gate.
  if (next.bump_type === "major" && !force) {
    const target = next.target_count ?? 0;
    const successful = await runs.countSuccessfulAtVersion(id, next.semver);
    if (successful < target) {
      throw new Error(
        `coverage ${successful}/${target} below 100% — use --force to promote anyway`
      );
    }
  }

  // Slot rotation:
  // 1. Drop existing previous (if any).
  // 2. Clear current's key, then rewrite into previous slot.
  // 3. Clear next's key, then rewrite into current slot.
  const previous = await reg.getPrevious(kind, id);
  if (previous) {
    await reg.clearSlot(kind, id, "previous");
  }
  await reg.clearSlot(kind, id, "current");
  await reg.putSlot({
    ...current,
    slot: "previous",
  });
  await reg.clearSlot(kind, id, "next");
  await reg.putSlot({
    ...next,
    slot: "current",
    coverage_complete: true,
    target_count: null,
  });

  await events.recordEvent({
    component_kind: kind,
    component_id: id,
    event_type: "promote",
    from_semver: current.semver,
    to_semver: next.semver,
    bump_type: next.bump_type,
    target_count: null,
    notes,
  });
}

export async function rollback(args: RollbackArgs): Promise<void> {
  const { reg, events, kind, id, notes } = args;
  assertRegistered(kind, id);

  const previous = await reg.getPrevious(kind, id);
  if (!previous) {
    throw new Error(
      `No previous slot for ${kind} '${id}'. Nothing to roll back to.`
    );
  }
  const current = await reg.getCurrent(kind, id);
  if (!current) throw new Error(`No current slot for ${kind} '${id}'.`);

  // Swap by clearing both and re-writing with swapped slot values.
  await reg.clearSlot(kind, id, "previous");
  await reg.clearSlot(kind, id, "current");
  await reg.putSlot({
    ...previous,
    slot: "current",
  });
  await reg.putSlot({
    ...current,
    slot: "previous",
  });

  await events.recordEvent({
    component_kind: kind,
    component_id: id,
    event_type: "rollback",
    from_semver: current.semver,
    to_semver: previous.semver,
    bump_type: null,
    target_count: null,
    notes,
  });
}

export async function dropNext(args: DropNextArgs): Promise<void> {
  const { reg, events, kind, id, notes } = args;
  assertRegistered(kind, id);

  const next = await reg.getNext(kind, id);
  if (!next) throw new Error(`No next slot for ${kind} '${id}'. Nothing to drop.`);

  await reg.clearSlot(kind, id, "next");

  await events.recordEvent({
    component_kind: kind,
    component_id: id,
    event_type: "drop-next",
    from_semver: next.semver,
    to_semver: null,
    bump_type: next.bump_type,
    target_count: null,
    notes,
  });
}
