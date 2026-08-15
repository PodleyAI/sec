/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { companyFamilyName } from "../../storage/company/CompanyFamilyName";
import { normalizeCompanyName } from "../../storage/company/CompanyNormalization";

/**
 * Kinds whose canonical rows are keyed off a company name, and so can split
 * when EDGAR carries two spellings of one filer.
 */
export const ALIAS_SUGGESTION_KINDS = ["company", "sponsor-family", "underwriter-family"] as const;
export type AliasSuggestionKind = (typeof ALIAS_SUGGESTION_KINDS)[number];

export function isAliasSuggestionKind(kind: string): kind is AliasSuggestionKind {
  return (ALIAS_SUGGESTION_KINDS as readonly string[]).includes(kind);
}

/** The key a kind's canonical tier is matched on. */
export function aliasSuggestionKey(kind: AliasSuggestionKind, name: string): string {
  return kind === "company" ? (normalizeCompanyName(name) ?? "") : companyFamilyName(name);
}

/**
 * Names shorter than this are excluded: at three or four characters an edit
 * distance of one is a different word, not a typo.
 */
const MIN_NAME_CHARS = 8;

/**
 * Edits allowed between two spellings of one filer's name.
 *
 * Two covers what EDGAR actually does — a transposition plus a dropped letter
 * (`Acquistion`, `Acquisiton`, `Aqusition` for `Acquisition`) — while staying
 * well under the distance between two genuinely different vehicles of one
 * sponsor, which differ by a whole series marker.
 */
const MAX_EDITS = 2;

/** Levenshtein distance, bailing out once it cannot come in under `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/** One filer's name as EDGAR has carried it, with whether it is the current one. */
export interface FilerName {
  readonly cik: number;
  readonly name: string;
  readonly current: boolean;
}

export interface AliasSuggestion {
  readonly cik: number;
  /** The spelling to retire. */
  readonly from: string;
  /** The spelling to keep — the filer's current name. */
  readonly into: string;
  readonly reason: string;
}

/**
 * Finds pairs of names belonging to ONE filer that key to different canonical
 * rows but are within {@link MAX_EDITS} of each other.
 *
 * These are EDGAR's own corrections. Five SIC-6770 registrants were filed under
 * a conformed name misspelling `Acquisition` (`Harvard Ave Acquistion Corp`,
 * `Cohen Circle Aqusition Corp. II`, …) and EDGAR later fixed the entity name —
 * but the accession keeps the misspelling forever, so each issuer normalizes two
 * ways and mints two canonical companies and two families.
 *
 * No normalizer can close this: `Acquistion` and `Acquisition` are different
 * words, and folding them would merge names that genuinely differ. It is an
 * alias — a stated, reviewable claim that two names are one entity — and the
 * evidence for it is that EDGAR filed both under one CIK. So this suggests, and
 * an operator decides; the output is shaped for `alias-import`.
 */
export function suggestAliases(
  kind: AliasSuggestionKind,
  names: readonly FilerName[]
): AliasSuggestion[] {
  const byCik = new Map<number, FilerName[]>();
  for (const entry of names) {
    const name = entry.name.trim();
    if (name.length < MIN_NAME_CHARS) continue;
    byCik.set(entry.cik, [...(byCik.get(entry.cik) ?? []), { ...entry, name }]);
  }

  const out: AliasSuggestion[] = [];
  for (const [cik, entries] of byCik) {
    const current = entries.find((e) => e.current);
    if (!current) continue;
    const currentKey = aliasSuggestionKey(kind, current.name);
    if (currentKey === "") continue;

    const seen = new Set<string>();
    for (const entry of entries) {
      if (entry.name === current.name) continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      // Same key already: nothing split, so nothing to alias.
      if (aliasSuggestionKey(kind, entry.name) === currentKey) continue;
      // Two vehicles of one sponsor differ by a series marker, and `… Corp I`
      // is ONE edit from `… Corp II` — well inside the typo budget. They are
      // different companies, and an alias would merge one's deals into the
      // other silently. The family key is what separates the two cases: it
      // strips the series marker, so names that agree there differ only by it.
      // (Not applied to the family kinds, whose key already IS that.)
      if (kind === "company" && companyFamilyName(entry.name) === companyFamilyName(current.name)) {
        continue;
      }
      const distance = editDistance(
        entry.name.toLowerCase(),
        current.name.toLowerCase(),
        MAX_EDITS
      );
      if (distance > MAX_EDITS) continue;
      out.push({
        cik,
        from: entry.name,
        into: current.name,
        reason: `EDGAR carried both spellings for CIK ${cik} (${distance} edit${distance === 1 ? "" : "s"})`,
      });
    }
  }
  return out.sort((a, b) => a.cik - b.cik || a.from.localeCompare(b.from));
}
