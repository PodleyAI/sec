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
import { PersonIdentityLinkRepo } from "../canonical/PersonIdentityLinkRepo";
import { CompanyIdentityLinkRepo } from "../canonical/CompanyIdentityLinkRepo";
import { CanonicalPersonRepo } from "../canonical/CanonicalPersonRepo";
import { CanonicalCompanyRepo } from "../canonical/CanonicalCompanyRepo";
import { CanonicalPersonAddressRepo } from "../canonical/CanonicalPersonAddressRepo";
import { CanonicalPersonPhoneRepo } from "../canonical/CanonicalPersonPhoneRepo";
import { CanonicalCompanyAddressRepo } from "../canonical/CanonicalCompanyAddressRepo";
import { CanonicalCompanyPhoneRepo } from "../canonical/CanonicalCompanyPhoneRepo";
import type { ResolverId } from "../../resolver/resolverIds";
import { computeResolverCoverage } from "../../cli/queries/ResolverCoverage";

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
  readonly dryRun?: boolean;
}

export interface PromoteArgs extends BaseArgs {
  /** Required when `kind === "extractor"`. Unused for resolvers. */
  readonly runs: ExtractorRunRepo;
  readonly force: boolean;
  readonly notes: string | null;
  readonly dryRun?: boolean;
}

export interface RollbackArgs extends BaseArgs {
  readonly notes: string | null;
  readonly dryRun?: boolean;
}

export interface DropNextArgs extends BaseArgs {
  readonly notes: string | null;
  readonly dryRun?: boolean;
}

export interface DropPreviousArgs extends BaseArgs {
  readonly notes: string | null;
  readonly dryRun?: boolean;
  /** Required when kind === "extractor". */
  readonly runs?: ExtractorRunRepo;
}

function assertRegistered(kind: ComponentKind, id: string): void {
  if (!isRegisteredComponent(kind, id)) {
    throw new Error(`No ${kind} registered: '${id}'`);
  }
}

/**
 * Begin (or, for patch bumps, complete) a version cycle. Major and minor
 * bumps populate the `next` slot; patch bumps update `current` in place
 * and log a `promote` event directly (degenerate promote). Validates
 * bump progression, registration, existing-next-conflict, and (for major)
 * non-negative target_count. Throws on any violation. When `dryRun: true`
 * all validations run but no writes happen.
 */
export async function startDev(args: StartDevArgs): Promise<void> {
  const { reg, events, kind, id, semver, bump, targetCount, notes } = args;
  assertRegistered(kind, id);

  const current = await reg.getCurrent(kind, id);
  if (!current) {
    throw new Error(
      `No current slot for ${kind} '${id}'. Run 'sec db setup' to bootstrap.`
    );
  }

  // Reject any new dev cycle (including patches) while one is in flight.
  // Operators must drop-next or complete the existing cycle first.
  const existingNext = await reg.getNext(kind, id);
  if (existingNext) {
    throw new Error(
      `next slot already exists for ${kind} '${id}' (at ${existingNext.semver}). drop-next first.`
    );
  }

  const progressionError = validateBumpProgression(current.semver, semver, bump);
  if (progressionError) throw new Error(progressionError);

  if (bump === "patch") {
    if (args.dryRun) return;
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

  // Major-only: validate target_count.
  if (bump === "major" && (targetCount === null || targetCount < 0)) {
    throw new Error(
      `major bump requires non-negative targetCount (got ${targetCount})`
    );
  }

  if (args.dryRun) return;

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

/**
 * Rotate the slots: previous := current, current := next, next is cleared.
 * For major bumps, requires count of successful runs at next.semver to
 * meet target_count unless `force: true`. Logs a `promote` event.
 * When `dryRun: true`, validations and the coverage check run but no
 * writes happen.
 */
export async function promote(args: PromoteArgs): Promise<void> {
  const { reg, events, runs, kind, id, force, notes } = args;
  assertRegistered(kind, id);

  const next = await reg.getNext(kind, id);
  if (!next) throw new Error(`No next slot for ${kind} '${id}'. Nothing to promote.`);

  const current = await reg.getCurrent(kind, id);
  if (!current) throw new Error(`No current slot for ${kind} '${id}'.`);

  // Major coverage gate. Dispatch by kind: extractors use extractor_runs
  // count; resolvers use identity-link-over-observation coverage.
  if (next.bump_type === "major" && !force) {
    if (next.target_count === null) {
      throw new Error(
        `${kind} '${id}' next slot has bump_type='major' but target_count is null — invalid state. Drop-next and re-run start-dev.`
      );
    }
    if (kind === "extractor") {
      const target = next.target_count;
      const successful = await runs.countSuccessfulAtVersion(id, next.semver);
      if (successful < target) {
        throw new Error(
          `coverage ${successful}/${target} below 100% — use --force to promote anyway`
        );
      }
    } else {
      // resolver — computeResolverCoverage throws for family-tier resolvers,
      // so promote is refused for them until family coverage lands.
      const coverage = await computeResolverCoverage(id as ResolverId, next.semver);
      if (coverage.fraction < 1.0) {
        throw new Error(
          `coverage ${coverage.numerator}/${coverage.denominator} below 100% — use --force to promote anyway`
        );
      }
    }
  }

  if (args.dryRun) return;

  // Slot rotation (non-atomic by design — workglow's storage doesn't expose
  // transactions; the spec's single-operator assumption makes this safe).
  // Sequence: drop existing previous -> clear current -> write current as previous
  // -> clear next -> write next as current.
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

/**
 * Swap previous and current. Used to undo a recent promote when the new
 * version turns out to be broken. Does not touch the next slot if one
 * exists. Logs a `rollback` event. When `dryRun: true`, validations
 * run but no slot writes happen.
 */
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

  if (args.dryRun) return;

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

/**
 * Discards an in-flight dev cycle by clearing the next slot. The matching
 * extractor_runs rows (`slot_at_run='next', extractor_version=<dropped>`)
 * are NOT deleted — they remain for audit purposes and to satisfy the
 * patch-gating reading-side rule (D7), which treats a row at "2.0.0" as
 * good for any "2.0.x" gate going forward. Logs a `drop-next` event.
 * When `dryRun: true`, validations run but no writes happen.
 *
 * Caveat for operators: if you drop-next a cycle and immediately re-run
 * start-dev at the SAME semver, the major coverage gate will see the old
 * cycle's successful runs as still counting (because countSuccessfulAtVersion
 * is exact-match on the version string). To avoid this surprise:
 *   - After abandonment of a buggy parser, bump to a new semver for the
 *     retry (e.g. 2.0.0 → 2.0.1 if the parser change is patch-compatible,
 *     or 2.1.0 / 3.0.0 if the parser logic differs meaningfully).
 *   - OR manually clear extractor_runs for the abandoned version before
 *     re-running (currently requires raw SQL; a `sec version reset-runs`
 *     command would be a useful follow-up).
 *
 * Documented operator discipline matches the single-operator
 * assumption and is acceptable for v1.
 */
export async function dropNext(args: DropNextArgs): Promise<void> {
  const { reg, events, kind, id, notes } = args;
  assertRegistered(kind, id);

  const next = await reg.getNext(kind, id);
  if (!next) throw new Error(`No next slot for ${kind} '${id}'. Nothing to drop.`);

  if (args.dryRun) return;

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

/**
 * Clears the previous slot and deletes all data associated with the previous
 * version. For extractors, deletes extractor_run rows at previous.semver. For
 * resolvers, deletes identity_link rows, junction rows (address/phone), and
 * orphaned canonical rows for the previous semver. Logs a `drop-previous`
 * event. When `dryRun: true`, validations run but no writes happen.
 */
export async function dropPrevious(args: DropPreviousArgs): Promise<void> {
  const { reg, events, kind, id, notes } = args;
  assertRegistered(kind, id);

  const previous = await reg.getPrevious(kind, id);
  if (!previous) {
    throw new Error(`No previous slot for ${kind} '${id}'. Nothing to drop.`);
  }

  if (args.dryRun) return;

  if (kind === "extractor") {
    if (!args.runs) throw new Error("runs repo required for extractor drop-previous");
    await args.runs.deleteForExtractorVersion(id, previous.semver);
  } else {
    // resolver
    const resolverId = id as ResolverId;
    if (resolverId === "person") {
      const linkRepo = new PersonIdentityLinkRepo();
      const junctionAddr = new CanonicalPersonAddressRepo();
      const junctionPhone = new CanonicalPersonPhoneRepo();
      const canonRepo = new CanonicalPersonRepo();
      await linkRepo.deleteForResolverVersion(previous.semver);
      await junctionAddr.deleteForResolverVersion(previous.semver);
      await junctionPhone.deleteForResolverVersion(previous.semver);
      await canonRepo.deleteForResolverVersion(previous.semver);
    } else if (resolverId === "company") {
      const linkRepo = new CompanyIdentityLinkRepo();
      const junctionAddr = new CanonicalCompanyAddressRepo();
      const junctionPhone = new CanonicalCompanyPhoneRepo();
      const canonRepo = new CanonicalCompanyRepo();
      await linkRepo.deleteForResolverVersion(previous.semver);
      await junctionAddr.deleteForResolverVersion(previous.semver);
      await junctionPhone.deleteForResolverVersion(previous.semver);
      await canonRepo.deleteForResolverVersion(previous.semver);
    } else {
      // Family-tier resolvers (sponsor-family / underwriter-family) store
      // canonical + membership + link rows, not identity-links/junctions. Their
      // version-scoped purge is not yet wired; refuse rather than fall through to
      // the company branch, which would destructively delete unrelated company
      // canonical/identity-link data at this semver.
      throw new Error(
        `drop-previous is not yet supported for family resolver kind '${resolverId}'. ` +
          `Purging canonical/membership/link rows by resolver_version is unimplemented; ` +
          `the previous slot was left intact.`
      );
    }
  }

  await reg.clearSlot(kind, id, "previous");

  await events.recordEvent({
    component_kind: kind,
    component_id: id,
    event_type: "drop-previous",
    from_semver: previous.semver,
    to_semver: null,
    bump_type: null,
    target_count: null,
    notes,
  });
}
