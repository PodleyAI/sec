/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EntityHistory } from "../../storage/entity/EntityHistorySchema";

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

  const rows: EntityHistory[] = [];
  let latestTo: string | undefined;

  for (const former of formerNames) {
    const validFrom = isoOrUndefined(former.from);
    if (validFrom === undefined || typeof former.name !== "string") continue;
    const validTo = isoOrUndefined(former.to) ?? null;
    rows.push({
      cik,
      valid_from: validFrom,
      valid_to: validTo,
      name: former.name,
      sic: null,
      ...unknownAtTime,
      change_source: NAME_HISTORY_CHANGE_SOURCE,
      change_date: changeDate,
    });
    if (validTo !== null && (latestTo === undefined || validTo > latestTo)) latestTo = validTo;
  }

  if (rows.length === 0) return [];

  const currentName = typeof submission.name === "string" ? submission.name : null;
  if (currentName !== null && latestTo !== undefined) {
    rows.push({
      cik,
      valid_from: latestTo,
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
