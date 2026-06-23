/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SpacDeal, SpacDealOutcome } from "./SpacDealSchema";
import type { SpacEvent, SpacEventType } from "./SpacEventSchema";
import type { SpacMergerExtraction } from "./SpacMergerExtractionSchema";

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
 * supersedes preliminary; latest non-null wins). Redemption actuals are deferred
 * (post-vote 8-K) and stay null. `created_at` is preserved from any existing row.
 */
export function deriveDeals(
  cik: number,
  events: readonly SpacEvent[],
  mergerExtractions: readonly SpacMergerExtraction[],
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
      .sort((a, b) => a.filing_date.localeCompare(b.filing_date));
    // Latest non-null wins per field; earlier non-nulls survive when later is null.
    for (const m of matched) {
      if (m.target_name != null) d.target_name = m.target_name;
      if (m.target_cik != null) d.target_cik = m.target_cik;
      if (m.pipe_amount != null) d.pipe_amount = m.pipe_amount;
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
    // redemption actuals: deferred (post-vote 8-K) — no source yet.
    redemption_amount: null,
    redemption_shares: null,
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
