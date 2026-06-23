/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Spac, SpacStatus } from "./SpacSchema";
import type { SpacDeal } from "./SpacDealSchema";
import type { SpacEvent } from "./SpacEventSchema";

/**
 * Filing-sourced scalar fields a population call can set directly. These are
 * merged under the `as_of` out-of-order guard; everything else on the row is
 * derived from the append-only deals + events.
 */
export interface SpacRowPatch {
  readonly current_cik?: number | null;
  readonly spac_name?: string | null;
  readonly surviving_name?: string | null;
  readonly current_name?: string | null;
  readonly spac_sic?: number | null;
  readonly post_merger_sic?: number | null;
  readonly current_sic?: number | null;
  readonly spac_tickers?: string | null;
  readonly post_merger_tickers?: string | null;
  readonly current_tickers?: string | null;
  readonly ipo_proceeds?: number | null;
  readonly trust_amount?: number | null;
}

export interface BuildSpacRowInput {
  readonly existing: Spac | undefined;
  readonly cik: number;
  readonly deals: readonly SpacDeal[];
  readonly events: readonly SpacEvent[];
  readonly patch: SpacRowPatch;
  /** Filing date of the filing driving this write; "" if unknown. */
  readonly filingDate: string;
}

function minEventDate(events: readonly SpacEvent[], type: string): string | null {
  const dates = events.filter((e) => e.event_type === type && e.event_date).map((e) => e.event_date);
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a.localeCompare(b) <= 0 ? a : b));
}

/**
 * The active deal = the completed deal if one exists; else the latest pending
 * deal by announced_date (deal_index breaks ties). Terminated deals never win.
 */
function activeDeal(deals: readonly SpacDeal[]): SpacDeal | null {
  const completed = deals.filter((d) => d.outcome === "completed");
  if (completed.length > 0) {
    return completed.reduce((a, b) =>
      (a.outcome_date ?? "").localeCompare(b.outcome_date ?? "") >= 0 ? a : b
    );
  }
  const pending = deals.filter((d) => d.outcome === "pending");
  if (pending.length === 0) return null;
  return pending.reduce((a, b) => {
    const cmp = (a.announced_date ?? "").localeCompare(b.announced_date ?? "");
    if (cmp !== 0) return cmp >= 0 ? a : b;
    return a.deal_index >= b.deal_index ? a : b;
  });
}

function deriveStatus(
  events: readonly SpacEvent[],
  active: SpacDeal | null,
  hasFailed: boolean,
  hasIpo: boolean,
  hasRegistration: boolean
): SpacStatus {
  if (active?.outcome === "completed") return "completed";
  if (hasFailed) return "liquidated";
  if (active) {
    if (active.vote_date || active.proxy_date) return "proxy";
    if (active.definitive_agreement_date || active.announced_date) return "deal_announced";
  }
  if (hasIpo) return events.some((e) => e.event_type === "unit_split") ? "searching" : "ipo";
  if (hasRegistration) return "registered";
  return "registered";
}

function sumRedemptions(deals: readonly SpacDeal[], events: readonly SpacEvent[]): number | null {
  let sum = 0;
  let seen = false;
  for (const d of deals) {
    if (d.redemption_amount != null) {
      sum += d.redemption_amount;
      seen = true;
    }
  }
  for (const e of events) {
    if (e.event_type === "redemption" && e.amount != null) {
      sum += e.amount;
      seen = true;
    }
  }
  return seen ? sum : null;
}

/** Build the full mutable `spac` row from the append-only deals/events + a filing patch. */
export function buildSpacRow(input: BuildSpacRowInput): Spac {
  const { existing, cik, deals, events, patch, filingDate } = input;

  // The patch only applies when the driving filing is not older than the row's
  // anchor. An undated filing ("") cannot be ordered and is treated as stale
  // when an existing dated anchor is present.
  const isStale =
    existing?.as_of != null &&
    existing.as_of !== "" &&
    (filingDate === "" || filingDate < existing.as_of);
  const applied: SpacRowPatch = isStale ? {} : patch;

  // Filing-sourced scalar fields: take the applied patch value, else keep existing.
  const pick = <K extends keyof SpacRowPatch>(key: K): Spac[K & keyof Spac] => {
    const fromPatch = applied[key];
    if (fromPatch !== undefined) return fromPatch as Spac[K & keyof Spac];
    return (existing ? (existing as any)[key] : null) as Spac[K & keyof Spac];
  };

  const spac_name = pick("spac_name");
  const spac_sic = pick("spac_sic");
  const spac_tickers = pick("spac_tickers");

  // Pre-merger, current_* mirrors spac_* unless a later filing set them explicitly.
  const surviving_name = pick("surviving_name");
  const current_name = applied.current_name ?? existing?.current_name ?? surviving_name ?? spac_name;
  const current_sic = applied.current_sic ?? existing?.current_sic ?? pick("post_merger_sic") ?? spac_sic;
  const current_tickers =
    applied.current_tickers ?? existing?.current_tickers ?? pick("post_merger_tickers") ?? spac_tickers;

  // Event/deal-derived fields: always recomputed (order-independent, idempotent).
  const active = activeDeal(deals);
  const hasFailed =
    events.some((e) => e.event_type === "liquidation" || e.event_type === "deregistration") &&
    !deals.some((d) => d.outcome === "completed");
  const hasIpo = events.some((e) => e.event_type === "ipo");
  const hasRegistration = events.some((e) => e.event_type === "registration");

  const nextAsOf =
    isStale || filingDate === ""
      ? (existing?.as_of ?? (filingDate === "" ? null : filingDate))
      : existing?.as_of != null && existing.as_of > filingDate
        ? existing.as_of
        : filingDate;

  return {
    cik,
    current_cik: pick("current_cik"),
    status: deriveStatus(events, active, hasFailed, hasIpo, hasRegistration),
    spac_name,
    target_name: active?.target_name ?? null,
    surviving_name,
    current_name,
    spac_sic,
    post_merger_sic: pick("post_merger_sic"),
    current_sic,
    spac_tickers,
    post_merger_tickers: pick("post_merger_tickers"),
    current_tickers,
    ipo_proceeds: pick("ipo_proceeds"),
    trust_amount: pick("trust_amount"),
    pipe_amount: active?.pipe_amount ?? null,
    total_redemption_amount: sumRedemptions(deals, events),
    registration_date: minEventDate(events, "registration"),
    ipo_date: minEventDate(events, "ipo"),
    unit_split_date: minEventDate(events, "unit_split"),
    definitive_agreement_date: active?.definitive_agreement_date ?? null,
    proxy_date: active?.proxy_date ?? null,
    vote_date: active?.vote_date ?? null,
    completed_date: active?.outcome === "completed" ? (active.outcome_date ?? null) : null,
    failed_date: hasFailed ? minEventDate(events, "liquidation") ?? minEventDate(events, "deregistration") : null,
    as_of: nextAsOf,
    updated_at: new Date().toISOString(),
  };
}
