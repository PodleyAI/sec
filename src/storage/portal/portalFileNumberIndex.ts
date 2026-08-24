/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../filing/FilingSchema";

/** The submission types that register, amend, or withdraw a funding portal. */
export const CFPORTAL_FORMS = ["CFPORTAL", "CFPORTAL/A", "CFPORTAL-W"] as const;

/**
 * A funding portal's SEC file number, reduced to a form two filers spell the
 * same way.
 *
 * The number is `007-00046`, but filers type it as they please: the committed
 * corpus carries `7-00065`, `007-000012` and `7-00700189` alongside the padded
 * form. Both halves are compared as integers when both parse, so `007-00046`,
 * `7-00046` and `007-0046` are one key. A half that does not parse is kept as
 * trimmed upper-case text rather than dropped — an unrecognized shape should
 * fail to resolve, not collide with everything else that also failed.
 *
 * Returns `undefined` for a value with no `-`, which is not a file number at
 * all. Resolving those by prefix match is what would let `7` match `007-00007`.
 */
export function normalizePortalFileNumber(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const dash = trimmed.indexOf("-");
  if (dash < 0) return undefined;
  const head = trimmed.slice(0, dash).trim();
  const tail = trimmed.slice(dash + 1).trim();
  if (head === "" || tail === "") return undefined;
  const part = (value: string): string =>
    /^\d+$/.test(value) ? String(Number(value)) : value.toUpperCase();
  return `${part(head)}-${part(tail)}`;
}

/**
 * File number -> CIK, over every CFPORTAL-family filing on record.
 *
 * Measured across the whole funding-portal universe (137 filers harvested from
 * EDGAR), file numbers are **1:1 with CIKs** — 137 distinct numbers, none
 * shared — which is what makes a succession's `acquiredPortalFileNumber` a join
 * key rather than a hint. A number that does turn out to be shared is dropped
 * from the index rather than resolved to an arbitrary one of its filers: an
 * ambiguous key is not evidence, and a wrong continuation hides a portal.
 *
 * `filings.file_number` is comma-joined when several apply, so each value is
 * split before indexing.
 */
export async function buildPortalFileNumberIndex(): Promise<Map<string, number>> {
  if (!globalServiceRegistry.has(FILING_REPOSITORY_TOKEN)) return new Map();
  const filings = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const rows =
    (await filings.query({
      form: { value: [...CFPORTAL_FORMS], operator: "in" },
    })) ?? [];

  const ciksByNumber = new Map<string, Set<number>>();
  for (const row of rows) {
    const cik = typeof row.cik === "number" ? row.cik : Number(row.cik);
    if (!Number.isFinite(cik)) continue;
    for (const piece of String(row.file_number ?? "").split(",")) {
      const key = normalizePortalFileNumber(piece);
      if (key === undefined) continue;
      const set = ciksByNumber.get(key) ?? new Set<number>();
      set.add(cik);
      ciksByNumber.set(key, set);
    }
  }

  const index = new Map<string, number>();
  for (const [key, ciks] of ciksByNumber) {
    if (ciks.size !== 1) continue;
    index.set(key, [...ciks][0]!);
  }
  return index;
}
