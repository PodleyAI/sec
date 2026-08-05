/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  EntityHistory,
  EntityHistoryRepositoryStorage,
} from "../../storage/entity/EntityHistorySchema";

/** Marks rows derived from the submissions feed's `formerNames` array. */
export const NAME_HISTORY_CHANGE_SOURCE = "SUBMISSIONS_FORMER_NAMES";

type FormerName = { name?: unknown; from?: unknown; to?: unknown };

/** ISO timestamp, or undefined when EDGAR left the field blank or malformed. */
function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function sicOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Builds the temporal name rows for one submission.
 *
 * EDGAR's `formerNames` carries `{name, from, to}` per rename, which maps onto
 * `entities_history`'s `valid_from`/`valid_to` directly. The current name is
 * appended as the open interval (`valid_to: null`) starting at the last
 * rename, so a renamed company has a gap-free timeline.
 *
 * Companies that never renamed produce no rows — `entities` already holds their
 * only name, and inventing a `valid_from` would be fabricating a date EDGAR
 * never gave us.
 *
 * `sic` is only known for the current row; the submissions feed carries no
 * historical SIC, so earlier intervals leave it null rather than back-project
 * today's value onto a period it may not describe.
 *
 * Shared by the ingest-time writer ({@link StoreSubmissionNameHistoryTask}) and
 * the one-shot replay over cached files ({@link BackfillNameHistoryTask}), so
 * both produce byte-identical rows and re-running either is an idempotent
 * upsert on `(cik, valid_from)`.
 */
export function buildNameHistoryRows(
  cik: number,
  submission: { name?: unknown; sic?: unknown; formerNames?: unknown },
  changeDate: string = new Date().toISOString()
): EntityHistory[] {
  const formerNames = Array.isArray(submission.formerNames)
    ? (submission.formerNames as FormerName[])
    : [];
  if (formerNames.length === 0) return [];

  // Fields the submissions feed carries no historical value for. Spelled out so
  // a schema addition surfaces here as a type error rather than a silent gap.
  const unknownAtTime = {
    type: null,
    ein: null,
    description: null,
    website: null,
    investor_website: null,
    category: null,
    fiscal_year: null,
    state_incorporation: null,
    state_incorporation_desc: null,
  } as const;

  // Sorted, because the close-at-the-next-rename rule below reads its
  // successor and EDGAR does not guarantee `formerNames` order.
  const formers = formerNames
    .map((former) => ({
      validFrom: isoOrUndefined(former.from),
      validTo: isoOrUndefined(former.to) ?? null,
      name: former.name,
    }))
    .filter(
      (f): f is { validFrom: string; validTo: string | null; name: string } =>
        f.validFrom !== undefined && typeof f.name === "string"
    )
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom));

  if (formers.length === 0) return [];

  const currentName = typeof submission.name === "string" ? submission.name : null;

  const rows: EntityHistory[] = [];
  let latestEnd: string | undefined;

  for (const [index, former] of formers.entries()) {
    // EDGAR sometimes leaves a rename's `to` blank. The interval still ends —
    // at the next rename's `from`, which is the only date EDGAR actually gave
    // us for it. A trailing blank `to` has no successor, so it stays open only
    // when there is no current name to promote over it; otherwise
    // `submission.name` is the authoritative name for the present and takes the
    // open interval. Closing it at `change_date` instead would fabricate a date
    // EDGAR never supplied, which this module never does.
    const validTo = former.validTo ?? formers[index + 1]?.validFrom ?? null;
    rows.push({
      cik,
      valid_from: former.validFrom,
      valid_to: currentName === null ? validTo : (validTo ?? former.validFrom),
      name: former.name,
      sic: null,
      ...unknownAtTime,
      change_source: NAME_HISTORY_CHANGE_SOURCE,
      change_date: changeDate,
    });
    // The open interval starts after every former interval — so `valid_to` when
    // there is one, and the interval's own `valid_from` for a trailing blank
    // `to`. Taking only `max(valid_to)` left the blank-`to` row open alongside
    // the current-name row, i.e. two current names for one CIK.
    const end = validTo ?? former.validFrom;
    if (latestEnd === undefined || end > latestEnd) latestEnd = end;
  }

  if (currentName !== null && latestEnd !== undefined) {
    rows.push({
      cik,
      valid_from: latestEnd,
      valid_to: null,
      name: currentName,
      sic: sicOrNull(submission.sic),
      ...unknownAtTime,
      change_source: NAME_HISTORY_CHANGE_SOURCE,
      change_date: changeDate,
    });
  }

  // EDGAR occasionally repeats a `from` across entries; the PK is (cik,
  // valid_from), so collapse to the last one rather than fail the bulk write.
  const byValidFrom = new Map<string, EntityHistory>();
  for (const row of rows) byValidFrom.set(row.valid_from, row);
  return [...byValidFrom.values()];
}

/**
 * Writes one CIK's name-history rows, reconciling away rows this module wrote
 * on a previous ingest that the current `formerNames` no longer produces.
 *
 * A plain `putBulk` upserts on `(cik, valid_from)` and so can only ever add. But
 * EDGAR revises `formerNames` — a later rename shifts where the open interval
 * starts, and the row that used to hold it stays behind still carrying
 * `valid_to: null`, leaving a CIK with two "current" names. Deleting the rows
 * that fell out of the rebuild is what keeps the timeline single-valued.
 *
 * Scoped to {@link NAME_HISTORY_CHANGE_SOURCE}: `entities_history` is shared
 * with `EntityTemporalRepo.saveEntityWithHistory`, which writes under its
 * caller's own `change_source`. An unscoped reconcile would silently delete
 * those rows.
 */
export async function writeNameHistoryRows(
  repo: EntityHistoryRepositoryStorage,
  cik: number,
  rows: readonly EntityHistory[]
): Promise<void> {
  if (rows.length === 0) return;

  const keep = new Set(rows.map((r) => r.valid_from));
  const existing = (await repo.query({ cik })) ?? [];
  for (const row of existing) {
    if (row.change_source !== NAME_HISTORY_CHANGE_SOURCE) continue;
    if (keep.has(row.valid_from)) continue;
    await repo.delete({ cik, valid_from: row.valid_from });
  }

  await repo.putBulk(rows as EntityHistory[]);
}
