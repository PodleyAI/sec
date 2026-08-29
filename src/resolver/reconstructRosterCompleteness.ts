/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PersonRoleRepo } from "../storage/canonical/PersonRoleRepo";
import { RoleRosterCompletenessRepo } from "../storage/canonical/RoleRosterCompletenessRepo";
import {
  RoleRosterCompletenessPrimaryKeyNames,
  type RoleRosterCompleteness,
} from "../storage/canonical/RoleRosterCompletenessSchema";

/** What one reconstruction pass found and wrote. */
export interface RosterCompletenessReconstruction {
  /** `person_role` rows read, across every resolver version. */
  readonly tenures: number;
  /** Distinct roster closures the tenures evidence. */
  readonly closures: number;
  /** Closures written, because no decision was recorded for them. */
  readonly written: number;
  /** Closures whose decision was already recorded, and left exactly as it was. */
  readonly alreadyRecorded: number;
  /** End-dated tenures naming no closing accession, so evidencing no roster. */
  readonly unattributed: number;
}

/**
 * The storage primary key of a completeness decision, as one string. Derived
 * from the key column list rather than restating it, so a change to the key
 * cannot leave this pass matching on a tuple the table is not keyed by.
 */
function completenessKey(
  row: Pick<RoleRosterCompleteness, (typeof RoleRosterCompletenessPrimaryKeyNames)[number]>
): string {
  return RoleRosterCompletenessPrimaryKeyNames.map((name) => String(row[name])).join("\x00");
}

/**
 * Rebuilds the `role_roster_completeness` decisions that the incremental path
 * acted on but never wrote down, from the closures it left behind in
 * `person_role`.
 *
 * `PersonRoleRepo.closeUnasserted` stamps `end_accession` alongside every
 * `end_date`, and it only ever runs for a roster the extraction declared
 * COMPLETE. So an end-dated tenure is itself the evidence: the filing named by
 * its `end_accession` enumerated the whole `(extractor_id, role_scope)` roster
 * at `company_cik` on `end_date`. That is exactly the row
 * {@link RoleRosterCompletenessSchema} holds, so each distinct closure
 * reconstructs one — one read of each table, one write per missing row, and no
 * re-extraction.
 *
 * **Two things it cannot recover, both erring the safe way.**
 *
 * - A `complete: false` verdict. Such a filing closed nothing, so it left no
 *   `end_accession` naming it and there is nothing here to read it off. It is
 *   also the one verdict absence already expresses: a rebuild treats a roster
 *   with no row as not known to be complete and closes nothing from it, which
 *   is what a `false` row would have made it do.
 * - A `complete: true` verdict for a filing whose roster nobody had left. It
 *   closed nothing either, so it leaves no trace — and a rebuild that does not
 *   know it was complete declines to close a tenure rather than inventing a
 *   departure.
 *
 * Both omissions therefore under-report departures. The opposite direction —
 * recording a completeness this cannot prove — would end tenures no filing
 * evidenced, which nothing downstream can tell from a real departure.
 *
 * **Never overwrites an existing decision**, which is both what makes a second
 * run write nothing and what keeps a re-extraction's later `false` verdict
 * from being silently restored to `true` by the closures the earlier
 * extraction had already made.
 *
 * Reads every tenure at once, like the rebuild it exists to make safe; it is a
 * one-shot repair on a corpus whose size that pass already bounds.
 */
export async function reconstructRosterCompleteness(): Promise<RosterCompletenessReconstruction> {
  const tenures = await new PersonRoleRepo().listAll();

  const derived = new Map<string, RoleRosterCompleteness>();
  let unattributed = 0;
  for (const tenure of tenures) {
    if (tenure.end_date === null) continue;
    // An end date with no closing accession names no filing, so it evidences
    // no roster. Reachable only as residue — every writer of `end_date` sets
    // both columns — and counted rather than guessed at.
    if (tenure.end_accession === null) {
      unattributed++;
      continue;
    }
    const decision: RoleRosterCompleteness = {
      accession_number: tenure.end_accession,
      extractor_id: tenure.extractor_id,
      role_scope: tenure.role_scope,
      company_cik: tenure.company_cik,
      // The closure ran with the filing's own date, and stamped it on every
      // tenure it closed, so sibling tenures under one key agree on it.
      filing_date: tenure.end_date,
      complete: true,
    };
    const key = completenessKey(decision);
    if (!derived.has(key)) derived.set(key, decision);
  }

  const repo = new RoleRosterCompletenessRepo();
  const recorded = new Set(
    (await repo.listForAccessions([...derived.values()].map((d) => d.accession_number))).map(
      completenessKey
    )
  );

  let written = 0;
  for (const [key, decision] of derived) {
    if (recorded.has(key)) continue;
    await repo.record(decision);
    written++;
  }

  return {
    tenures: tenures.length,
    closures: derived.size,
    written,
    alreadyRecorded: derived.size - written,
    unattributed,
  };
}
