/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Spac, SpacStatus, SurvivingNameSource } from "./SpacSchema";
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
  readonly current_trust_amount?: number | null;
  readonly current_trust_as_of?: string | null;
  readonly current_trust_filed?: string | null;
  // Narrative / enrichment scalars (embarc-facing). `focus` / `focus_location`
  // / `details` are JSON-encoded strings; `url_sponsor` is editorial (no SEC
  // writer), preserved across replays like the rest.
  readonly focus?: string | null;
  readonly focus_location?: string | null;
  readonly description?: string | null;
  readonly team?: string | null;
  readonly details?: string | null;
  readonly url_spac?: string | null;
  readonly url_sponsor?: string | null;
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
  const dates = events
    .filter((e) => e.event_type === type && e.event_date)
    .map((e) => e.event_date);
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a.localeCompare(b) <= 0 ? a : b));
}

/**
 * Latest investor-presentation exhibit (url + date). Derived from the event
 * stream — an `investor_presentation` event carries the deck URL in
 * `source_document_url`. Population of these events is deferred to a dedicated
 * 8-K Item 7.01 EX-99 exhibit extractor; until then this yields null/null.
 */
function latestInvestorPres(events: readonly SpacEvent[]): {
  url: string | null;
  date: string | null;
} {
  // Single-pass max by (event_date, accession_number); no need to sort the array.
  let latest: SpacEvent | null = null;
  for (const e of events) {
    if (e.event_type !== "investor_presentation") continue;
    if (
      latest === null ||
      e.event_date.localeCompare(latest.event_date) > 0 ||
      (e.event_date === latest.event_date &&
        e.accession_number.localeCompare(latest.accession_number) > 0)
    ) {
      latest = e;
    }
  }
  return { url: latest?.source_document_url ?? null, date: latest?.event_date ?? null };
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
  hasIpo: boolean
): SpacStatus {
  if (active?.outcome === "completed") return "completed";
  if (hasFailed) return "liquidated";
  if (active) {
    if (active.vote_date || active.proxy_date) return "proxy";
    if (active.definitive_agreement_date || active.announced_date) return "deal_announced";
    // A non-binding LOI sits between searching and deal_announced; the checks
    // above ensure any later definitive agreement / vote supersedes it.
    if (active.loi_date) return "loi";
  }
  if (hasIpo) return events.some((e) => e.event_type === "unit_split") ? "searching" : "ipo";
  // Form RW: the registration was pulled before it priced. An IPO already
  // recorded above stays ipo — withdrawing a later S-3 does not un-IPO the shell.
  // A later S-1 after the last RW reopens the row (the first S-1's registration
  // event stays on the stream, so "any withdrawal" is not terminal).
  if (isWithdrawnWithoutLaterRegistration(events)) return "withdrawn";
  return "registered";
}

function latestEventDate(events: readonly SpacEvent[], type: string): string | null {
  const dates = events
    .filter((e) => e.event_type === type && e.event_date)
    .map((e) => e.event_date);
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a.localeCompare(b) >= 0 ? a : b));
}

function isWithdrawnWithoutLaterRegistration(events: readonly SpacEvent[]): boolean {
  const lastWithdrawal = latestEventDate(events, "withdrawal");
  if (lastWithdrawal == null) return false;
  return !events.some(
    (e) => e.event_type === "registration" && e.event_date.localeCompare(lastWithdrawal) > 0
  );
}

/**
 * The per-deal `redemption_amount` column (derived by `deriveDeals` correlating
 * each redemption extraction onto exactly one deal) is the SOLE source of the
 * rolled-up total, so each realized redemption is counted once. We deliberately
 * do NOT also sum `redemption`-typed events: `recordRedemption` appends none,
 * and summing both would double-count an extraction that is already on a deal.
 */
function sumRedemptions(deals: readonly SpacDeal[]): number | null {
  let sum = 0;
  let seen = false;
  for (const d of deals) {
    if (d.redemption_amount != null) {
      sum += d.redemption_amount;
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
  // When the patch is stale, it may still fill a null field but cannot overwrite a
  // non-null existing value — preserving the most-informative data across replays.
  const pick = <K extends keyof SpacRowPatch>(key: K): Spac[K & keyof Spac] => {
    const existingVal = (existing ? (existing as any)[key] : null) as Spac[K & keyof Spac];
    const fromPatch = patch[key];
    if (isStale) {
      // Stale filing may fill a null slot but must not clobber a non-null value.
      if (existingVal == null && fromPatch !== undefined) return fromPatch as Spac[K & keyof Spac];
      return existingVal;
    }
    const fromApplied = applied[key];
    // Treat an explicit null like an absent field: a newer filing that does not
    // carry a value must not clobber an existing non-null one (merge, not erase).
    if (fromApplied != null) return fromApplied as Spac[K & keyof Spac];
    return existingVal;
  };

  const spac_name = pick("spac_name");
  const spac_sic = pick("spac_sic");
  const spac_tickers = pick("spac_tickers");

  // Event/deal-derived fields: always recomputed (order-independent, idempotent).
  const active = activeDeal(deals);
  const completed = active?.outcome === "completed";

  // De-SPAC linkage: a completed business combination links the shell to its
  // surviving entity. Absent an explicit (entity-sourced) name from a
  // `recordDeSpacLinkage` patch, the combined company is named after the deal's
  // target, so derive `surviving_name` from the completed deal's target_name.
  //
  // The derived value IS persisted, so it must be re-derived on every rebuild
  // rather than read back as if it were explicit — otherwise a later proxy that
  // supersedes `target_name` (definitive over preliminary, revised over
  // definitive) could never correct it. Only an entity-sourced snapshot is
  // preserved, which `surviving_name_source` is what distinguishes.
  const survivingFromEntity =
    applied.surviving_name ??
    (existing?.surviving_name_source === "entity" ? (existing.surviving_name ?? null) : null);
  const surviving_name = survivingFromEntity ?? (completed ? (active?.target_name ?? null) : null);
  const surviving_name_source: SurvivingNameSource | null =
    survivingFromEntity != null ? "entity" : surviving_name != null ? "deal-target" : null;
  const post_merger_sic = pick("post_merger_sic");
  const post_merger_tickers = pick("post_merger_tickers");

  // current_* is the latest-known identity. Pre-merger it mirrors spac_*; a
  // completed de-SPAC promotes the surviving / post-merger identity over the
  // stale mirrored value, so a row that stored current_name = spac_name at
  // registration reflects the rename once the combination closes. When the
  // post-merger value is not yet known (no target/entity data), it falls
  // through to the previously mirrored value.
  const current_name =
    applied.current_name ??
    (completed ? surviving_name : null) ??
    existing?.current_name ??
    surviving_name ??
    spac_name;
  const current_sic =
    applied.current_sic ??
    (completed ? post_merger_sic : null) ??
    existing?.current_sic ??
    post_merger_sic ??
    spac_sic;
  const current_tickers =
    applied.current_tickers ??
    (completed ? post_merger_tickers : null) ??
    existing?.current_tickers ??
    post_merger_tickers ??
    spac_tickers;

  const investorPres = latestInvestorPres(events);
  const hasFailed =
    events.some((e) => e.event_type === "liquidation" || e.event_type === "deregistration") &&
    !deals.some((d) => d.outcome === "completed");
  const hasIpo = events.some((e) => e.event_type === "ipo");

  // A non-stale dated filing advances the anchor to its filing date; a stale or
  // undated write keeps the existing anchor (never regresses it). The arms the
  // isStale/"" guards would otherwise reach are dead, so this collapses cleanly.
  const nextAsOf = isStale || filingDate === "" ? (existing?.as_of ?? null) : filingDate;

  return {
    cik,
    current_cik: pick("current_cik"),
    status: deriveStatus(events, active, hasFailed, hasIpo),
    spac_name,
    target_name: active?.target_name ?? null,
    target_description: active?.target_description ?? null,
    surviving_name,
    surviving_name_source,
    current_name,
    spac_sic,
    post_merger_sic,
    current_sic,
    spac_tickers,
    post_merger_tickers,
    current_tickers,
    ipo_proceeds: pick("ipo_proceeds"),
    trust_amount: pick("trust_amount"),
    current_trust_amount: pick("current_trust_amount"),
    current_trust_as_of: pick("current_trust_as_of"),
    current_trust_filed: pick("current_trust_filed"),
    focus: pick("focus"),
    focus_location: pick("focus_location"),
    description: pick("description"),
    team: pick("team"),
    details: pick("details"),
    url_spac: pick("url_spac"),
    url_sponsor: pick("url_sponsor"),
    investorpres_url: investorPres.url,
    investorpres_date: investorPres.date,
    pipe_amount: active?.pipe_amount ?? null,
    total_redemption_amount: sumRedemptions(deals),
    registration_date: minEventDate(events, "registration"),
    ipo_date: minEventDate(events, "ipo"),
    unit_split_date: minEventDate(events, "unit_split"),
    loi_date: active?.loi_date ?? null,
    definitive_agreement_date: active?.definitive_agreement_date ?? null,
    proxy_date: active?.proxy_date ?? null,
    vote_date: active?.vote_date ?? null,
    completed_date: active?.outcome === "completed" ? (active.outcome_date ?? null) : null,
    failed_date: hasFailed
      ? (minEventDate(events, "liquidation") ?? minEventDate(events, "deregistration"))
      : null,
    as_of: nextAsOf,
    updated_at: new Date().toISOString(),
  };
}
