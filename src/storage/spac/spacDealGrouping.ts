/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SpacDeal, SpacDealOutcome } from "./SpacDealSchema";
import type { SpacEvent, SpacEventType } from "./SpacEventSchema";
import type { SpacMergerExtraction } from "./SpacMergerExtractionSchema";
import type { SpacRedemptionExtraction } from "./SpacRedemptionExtractionSchema";

/**
 * Supersession precedence for merger-proxy forms when two land on the same
 * filing_date, ordered by the filing lifecycle PREM -> PRER -> DEFM -> DEFR:
 * definitive supersedes preliminary, and within each stage the revised form
 * supersedes its base. A preliminary-revised proxy (PRER) therefore outranks
 * the preliminary it revises (PREM) but is still superseded by the definitive
 * (DEFM) — it does NOT outrank DEFM the way the definitive-revised (DEFR) does.
 * Used only as a same-date tiebreak; filing_date still dominates.
 */
function mergerFormRank(form: string): number {
  const f = form.toUpperCase();
  if (f.startsWith("DEFR")) return 3; // definitive, revised
  if (f.startsWith("DEFM")) return 2; // definitive
  if (f.startsWith("PRER")) return 1; // preliminary, revised
  return 0; // PREM (preliminary) and anything else
}

/** Event types that shape a business-combination attempt. */
const DEAL_RELEVANT_EVENT_TYPES: readonly SpacEventType[] = [
  "definitive_agreement",
  "terminated",
  "completed",
  "vote",
  "proxy",
];

interface DealSkeleton {
  deal_index: number;
  announced_date: string | null;
  definitive_agreement_date: string | null;
  proxy_date: string | null;
  vote_date: string | null;
  outcome: SpacDealOutcome;
  outcome_date: string | null;
  source_accession: string | null;
  // §4b columns, derived by correlating merger extractions (below).
  target_name: string | null;
  target_cik: number | null;
  pipe_amount: number | null;
  // Columns derived by correlating redemption extractions (below).
  redemption_amount: number | null;
  redemption_shares: number | null;
}

/**
 * Rebuild the full {@link SpacDeal} set for a CIK from its append-only events
 * and merger-proxy extractions.
 *
 * Deterministic + replay-safe: events are ordered by `(event_date,
 * accession_number)` and walked with a single "open deal" cursor, so the same
 * event set always yields the same `deal_index` assignments. `source_accession`
 * reflects the latest event that shaped the deal. 8-K-owned columns
 * (`announced_date`, `definitive_agreement_date`, `vote_date`, `outcome`,
 * `outcome_date`) and `proxy_date` come from the event walk.
 *
 * §4b-owned columns (`target_name`, `target_cik`, `pipe_amount`) are **derived**
 * by correlating each {@link SpacMergerExtraction} to the deal whose
 * `[announced, closed)` window contains the proxy's `filing_date` (definitive
 * supersedes preliminary; latest non-null wins). Redemption columns
 * (`redemption_amount`, `redemption_shares`) are derived from
 * {@link SpacRedemptionExtraction} rows by announcement window (upper bound is the
 * next deal's announcement, not the current deal's outcome_date, so a redemption
 * reported at or after closing still attaches to that deal). `created_at` is
 * preserved from any existing row.
 */
export function deriveDeals(
  cik: number,
  events: readonly SpacEvent[],
  mergerExtractions: readonly SpacMergerExtraction[],
  redemptionExtractions: readonly SpacRedemptionExtraction[],
  existingDeals: readonly SpacDeal[]
): SpacDeal[] {
  const relevant = events
    .filter((e) => DEAL_RELEVANT_EVENT_TYPES.includes(e.event_type as SpacEventType))
    .sort(
      (a, b) =>
        a.event_date.localeCompare(b.event_date) ||
        a.accession_number.localeCompare(b.accession_number)
    );

  const skeletons: DealSkeleton[] = [];
  let open: DealSkeleton | null = null;
  let nextIndex = 0;

  const openNew = (e: SpacEvent): DealSkeleton => {
    const d: DealSkeleton = {
      deal_index: nextIndex++,
      announced_date: null,
      definitive_agreement_date: null,
      proxy_date: null,
      vote_date: null,
      outcome: "pending",
      outcome_date: null,
      source_accession: e.accession_number,
      target_name: null,
      target_cik: null,
      pipe_amount: null,
      redemption_amount: null,
      redemption_shares: null,
    };
    skeletons.push(d);
    return d;
  };

  for (const e of relevant) {
    switch (e.event_type) {
      case "definitive_agreement": {
        if (!open) open = openNew(e);
        if (open.announced_date == null) open.announced_date = e.event_date;
        if (
          open.definitive_agreement_date == null ||
          e.event_date > open.definitive_agreement_date
        ) {
          open.definitive_agreement_date = e.event_date;
        }
        open.source_accession = e.accession_number;
        break;
      }
      case "terminated": {
        if (open) {
          open.outcome = "terminated";
          open.outcome_date = e.event_date;
          open.source_accession = e.accession_number;
          open = null;
        }
        break;
      }
      case "completed": {
        const d = open ?? openNew(e);
        d.outcome = "completed";
        d.outcome_date = e.event_date;
        d.source_accession = e.accession_number;
        open = null;
        break;
      }
      case "vote": {
        if (open) {
          if (open.vote_date == null || e.event_date > open.vote_date) {
            open.vote_date = e.event_date;
          }
          open.source_accession = e.accession_number;
        }
        break;
      }
      case "proxy": {
        if (open) {
          if (open.proxy_date == null || e.event_date > open.proxy_date) {
            open.proxy_date = e.event_date;
          }
          open.source_accession = e.accession_number;
        }
        // No open deal -> proxy with no announced deal: timeline-only.
        break;
      }
    }
  }

  // --- Correlate merger extractions onto deals by filing-date window ---
  // A deal owns [lower, upper): lower = its announced/DA date, upper = its
  // outcome_date else the next deal's announced date else open-ended.
  for (let i = 0; i < skeletons.length; i++) {
    const d = skeletons[i];
    const lower = d.announced_date ?? d.definitive_agreement_date ?? null;
    const upper = d.outcome_date ?? skeletons[i + 1]?.announced_date ?? null;
    const matched = mergerExtractions
      .filter(
        (m) =>
          (lower == null || m.filing_date >= lower) && (upper == null || m.filing_date < upper)
      )
      // Deterministic supersession: by filing_date, then by form precedence
      // (definitive > preliminary, revised > definitive — see CLAUDE.md), then
      // by accession so ties resolve identically on every backend rather than
      // depending on getByCik()'s unspecified row order.
      .sort(
        (a, b) =>
          a.filing_date.localeCompare(b.filing_date) ||
          mergerFormRank(a.form) - mergerFormRank(b.form) ||
          a.accession_number.localeCompare(b.accession_number)
      );
    // Latest non-null wins per field; earlier non-nulls survive when later is null.
    for (const m of matched) {
      if (m.target_name != null) d.target_name = m.target_name;
      if (m.target_cik != null) d.target_cik = m.target_cik;
      if (m.pipe_amount != null) d.pipe_amount = m.pipe_amount;
    }
  }

  // --- Correlate redemption extractions onto deals by announcement window ---
  // The deals contiguously partition the timeline: deal i owns [B(i-1), B(i)),
  // where B(k) is the boundary between deal k and deal k+1 = the next deal's
  // earliest date (announced/DA/outcome). The first deal's lower bound is
  // unbounded (B(-1) = null) so a redemption reported before the first recorded
  // deal date — e.g. a vote-results 8-K for a deal opened only by `completed`
  // (no 1.01), whose only date is its later outcome_date — still attaches.
  // Unlike the merger window this ignores outcome_date for the upper bound, so a
  // redemption reported at/after closing still attaches to the deal being closed.
  const dealLower = (d: DealSkeleton): string | null =>
    d.announced_date ?? d.definitive_agreement_date ?? d.outcome_date ?? null;
  for (let i = 0; i < skeletons.length; i++) {
    const d = skeletons[i];
    const lower = i === 0 ? null : dealLower(d);
    const upper = skeletons[i + 1] ? dealLower(skeletons[i + 1]) : null;
    const matched = redemptionExtractions
      .filter(
        (r) =>
          (lower == null || r.filing_date >= lower) && (upper == null || r.filing_date < upper)
      )
      // accession is the deterministic tiebreak for same-date 8-Ks.
      .sort(
        (a, b) =>
          a.filing_date.localeCompare(b.filing_date) ||
          a.accession_number.localeCompare(b.accession_number)
      );
    // Latest non-null wins per field; earlier non-nulls survive when a later filing omits them.
    for (const r of matched) {
      if (r.redemption_amount != null) d.redemption_amount = r.redemption_amount;
      if (r.redemption_shares != null) d.redemption_shares = r.redemption_shares;
    }
  }

  const existingByIndex = new Map(existingDeals.map((d) => [d.deal_index, d]));
  return skeletons.map((s) => ({
    cik,
    deal_index: s.deal_index,
    // §4b columns: derived from correlated extractions (no merge-preserve).
    target_name: s.target_name,
    target_cik: s.target_cik,
    pipe_amount: s.pipe_amount,
    // proxy_date: derived from the proxy event in the walk.
    proxy_date: s.proxy_date,
    // Columns derived from correlated redemption extractions.
    redemption_amount: s.redemption_amount,
    redemption_shares: s.redemption_shares,
    // 8-K-owned columns:
    announced_date: s.announced_date,
    definitive_agreement_date: s.definitive_agreement_date,
    vote_date: s.vote_date,
    outcome: s.outcome,
    outcome_date: s.outcome_date,
    source_accession: s.source_accession,
    created_at: existingByIndex.get(s.deal_index)?.created_at ?? new Date().toISOString(),
  }));
}
