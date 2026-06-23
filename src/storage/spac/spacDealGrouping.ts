/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SpacDeal, SpacDealOutcome } from "./SpacDealSchema";
import type { SpacEvent, SpacEventType } from "./SpacEventSchema";

/** Event types that shape a business-combination attempt. */
const DEAL_RELEVANT_EVENT_TYPES: readonly SpacEventType[] = [
  "definitive_agreement",
  "terminated",
  "completed",
  "vote",
];

interface DealSkeleton {
  deal_index: number;
  announced_date: string | null;
  definitive_agreement_date: string | null;
  vote_date: string | null;
  outcome: SpacDealOutcome;
  outcome_date: string | null;
  source_accession: string | null;
}

/**
 * Rebuild the full {@link SpacDeal} set for a CIK from its append-only events.
 *
 * Deterministic + replay-safe: events are ordered by `(event_date,
 * accession_number)` and walked with a single "open deal" cursor, so the same
 * event set always yields the same `deal_index` assignments. `source_accession`
 * reflects the latest event that shaped the deal (the completion accession for a
 * completed deal; the latest DA for a pending one).
 *
 * The result merge-preserves §4b-owned columns (`target_*`, `pipe_amount`,
 * `redemption_*`, `proxy_date`) and `created_at` from any existing deal row.
 * That merge binds existing rows to recomputed deals positionally by
 * `deal_index`, which assumes the upstream event set stays append-only and
 * stable: a back-filled earlier-dated DA that renumbers attempts would rebind
 * enriched data to a different attempt — an accepted, rare property of strict
 * chronological ordinals.
 */
export function deriveDealsFromEvents(
  cik: number,
  events: readonly SpacEvent[],
  existingDeals: readonly SpacDeal[]
): SpacDeal[] {
  const relevant = events
    .filter((e) => DEAL_RELEVANT_EVENT_TYPES.includes(e.event_type))
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
      vote_date: null,
      outcome: "pending",
      outcome_date: null,
      source_accession: e.accession_number,
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
    }
  }

  const existingByIndex = new Map(existingDeals.map((d) => [d.deal_index, d]));
  return skeletons.map((s) => {
    const prev = existingByIndex.get(s.deal_index);
    return {
      cik,
      deal_index: s.deal_index,
      target_name: prev?.target_name ?? null,
      target_cik: prev?.target_cik ?? null,
      proxy_date: prev?.proxy_date ?? null,
      pipe_amount: prev?.pipe_amount ?? null,
      redemption_amount: prev?.redemption_amount ?? null,
      redemption_shares: prev?.redemption_shares ?? null,
      announced_date: s.announced_date,
      definitive_agreement_date: s.definitive_agreement_date,
      vote_date: s.vote_date,
      outcome: s.outcome,
      outcome_date: s.outcome_date,
      source_accession: s.source_accession,
      created_at: prev?.created_at ?? new Date().toISOString(),
    };
  });
}
