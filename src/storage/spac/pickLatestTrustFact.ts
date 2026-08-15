/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CompanyFact } from "../facts/CompanyFactsSchema";

const PERIODIC_FORMS = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A"]);

function isTrustConcept(name: string): boolean {
  return name.toLowerCase().includes("assetsheldintrust");
}

function groupingRank(grouping: string): number {
  return grouping === "spac" ? 0 : 1;
}

function nameRank(name: string): number {
  return name === "AssetsHeldInTrust" ? 0 : 1;
}

/**
 * Latest quarterly/annual trust-account balance from company facts.
 *
 * Prefers a later period end, then a later filed date (so a 10-Q/A restates
 * the same quarter), then the `spac` taxonomy over `us-gaap`, then the
 * unqualified `AssetsHeldInTrust` total over a current/noncurrent split.
 */
export function pickLatestTrustFact(facts: readonly CompanyFact[]): CompanyFact | null {
  let best: CompanyFact | null = null;
  for (const fact of facts) {
    if (!PERIODIC_FORMS.has(fact.form)) continue;
    if (!isTrustConcept(fact.name)) continue;
    if (fact.end_date == null || fact.end_date === "") continue;
    if (!Number.isFinite(fact.val) || fact.val <= 0) continue;
    if (best == null || compareTrustFacts(fact, best) < 0) best = fact;
  }
  return best;
}

/** Negative when `a` should win over `b`. */
function compareTrustFacts(a: CompanyFact, b: CompanyFact): number {
  const end = (b.end_date ?? "").localeCompare(a.end_date ?? "");
  if (end !== 0) return end;
  const filed = b.filed_date.localeCompare(a.filed_date);
  if (filed !== 0) return filed;
  const grouping = groupingRank(a.grouping) - groupingRank(b.grouping);
  if (grouping !== 0) return grouping;
  return nameRank(a.name) - nameRank(b.name);
}

/**
 * Whether an incoming company-facts snapshot should replace the one already
 * on the spac row. At an equal period-end a strictly later filed date wins, so
 * a 10-Q/A restatement applies while an identical re-read of the same filing
 * does not re-write the row. An older quarter never regresses.
 */
export function isNewerTrustSnapshot(
  incoming: { readonly asOf: string; readonly filed: string },
  existing: { readonly asOf: string | null; readonly filed: string | null }
): boolean {
  if (existing.asOf == null || existing.asOf === "") return true;
  if (incoming.asOf > existing.asOf) return true;
  if (incoming.asOf < existing.asOf) return false;
  return existing.filed == null || incoming.filed > existing.filed;
}
