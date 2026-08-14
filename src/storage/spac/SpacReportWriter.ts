/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, uuid4 } from "workglow";
import { SpacRepo } from "./SpacRepo";
import { recomputeSpacDeals } from "./SpacDealReplace";
import { isNewerTrustSnapshot } from "./pickLatestTrustFact";
import { buildSpacRow, type SpacRowPatch } from "./spacRollup";
import { deriveDeals } from "./spacDealGrouping";
import { SpacMergerExtractionRepo } from "./SpacMergerExtractionRepo";
import { SpacRedemptionExtractionRepo } from "./SpacRedemptionExtractionRepo";
import type { Spac } from "./SpacSchema";
import type { SpacEvent, SpacEventType } from "./SpacEventSchema";
import { ITEM_MAPPED_EVENT_TYPES } from "./SpacEventSchema";
import type { SpacHistory } from "./SpacHistorySchema";
import { CHANGE_LOG_REPOSITORY_TOKEN } from "../change-tracking/ChangeLogSchema";
import { EntityRepo } from "../entity/EntityRepo";
import { AsyncMutex } from "../../util/AsyncMutex";

/**
 * Per-CIK write serialisation. Each public `record*` method runs a
 * read-derive-write cycle over the CIK's spac / spac_deal / spac_history rows
 * (append event → recompute deals → rebuild row → snapshot history). Two
 * filings for the SAME CIK can be processed concurrently — the form tasks map
 * over filings with `concurrencyLimit > 1` — so without a lock their cycles
 * interleave across `await` boundaries and either lost-update the derived row
 * or fork the history chain (two open rows).
 *
 * The map is module-scoped because every caller constructs a fresh
 * `SpacReportWriter` (an instance field would not serialise across writers),
 * and is refcounted / evicted at zero to stay bounded — mirroring the resolver
 * per-key mutex. Single-process only: multi-process callers still rely on the
 * append-only event PK `(cik, accession_number, event_type)` for idempotency.
 */
const cikWriteMutexes = new Map<number, { mutex: AsyncMutex; refs: number }>();

function withCikLock<T>(cik: number, fn: () => Promise<T>): Promise<T> {
  let entry = cikWriteMutexes.get(cik);
  if (entry === undefined) {
    entry = { mutex: new AsyncMutex(), refs: 0 };
    cikWriteMutexes.set(cik, entry);
  }
  entry.refs += 1;
  const held = entry;
  return held.mutex.lock(fn).finally(() => {
    held.refs -= 1;
    // Same-identity check guards against a caller recreating the entry between
    // the decrement and the delete.
    if (held.refs === 0 && cikWriteMutexes.get(cik) === held) {
      cikWriteMutexes.delete(cik);
    }
  });
}

interface RecordRegistrationArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly form: string;
  readonly primary_document: string | null;
  readonly spac_name: string | null;
  readonly spac_sic: number | null;
  // Narrative enrichment from the S-1 "Prospectus Summary" AI section. All
  // optional; a filing that carries none leaves the row's values untouched
  // (the rollup merges, never clobbers with null).
  readonly focus?: string | null;
  readonly focus_location?: string | null;
  readonly description?: string | null;
  readonly team?: string | null;
  readonly url_spac?: string | null;
}

interface RecordIpoArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly form: string;
  readonly primary_document: string | null;
  readonly ipo_proceeds: number | null;
  readonly trust_amount: number | null;
  readonly spac_tickers: readonly string[] | null;
}

interface RecordDealMilestonesArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly form: string;
  readonly primary_document: string | null;
  /** event_date is pre-resolved by the caller (report_date ?? filing_date). */
  readonly events: readonly {
    event_type: SpacEventType;
    event_date: string;
    detail?: string | null;
  }[];
}

interface RecordMergerProxyArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly form: string;
  readonly primary_document: string | null;
  /** true for DEFM14A (definitive); false for PREM14A (preliminary). */
  readonly emitProxyEvent: boolean;
}

/**
 * Editorial (hand-curated) scalar fields. These have no reliable SEC-filing
 * source; they are set via `sec editorial` and must survive filing replays.
 * Only fields present (non-undefined) are written; an omitted field is left
 * untouched. Explicit null is not a clear — pass a new value to change one.
 */
export interface RecordEditorialArgs {
  readonly cik: number;
  readonly url_spac?: string;
  readonly url_sponsor?: string;
  /** JSON-encoded key/value map (embarc detail-page freeform details). */
  readonly details?: string;
}

/** Fields compared for ChangeLog/history; everything except the volatile timestamp. */
const TRACKED_FIELDS: readonly (keyof Spac)[] = [
  "current_cik",
  "status",
  "spac_name",
  "target_name",
  "surviving_name",
  "current_name",
  "spac_sic",
  "post_merger_sic",
  "current_sic",
  "spac_tickers",
  "post_merger_tickers",
  "current_tickers",
  "ipo_proceeds",
  "trust_amount",
  "current_trust_amount",
  "current_trust_as_of",
  "current_trust_filed",
  "pipe_amount",
  "total_redemption_amount",
  "focus",
  "focus_location",
  "description",
  "target_description",
  "team",
  "details",
  "url_spac",
  "url_sponsor",
  "investorpres_url",
  "investorpres_date",
  "registration_date",
  "ipo_date",
  "unit_split_date",
  "loi_date",
  "definitive_agreement_date",
  "proxy_date",
  "vote_date",
  "completed_date",
  "failed_date",
];

/**
 * Milliseconds for a history timestamp, used by the snapshot monotonicity math.
 *
 * The schema declares these columns `type: "string"`, but a backend can still
 * hand back a `Date` (Postgres maps `format: "date-time"` to TIMESTAMP). That
 * matters here specifically: `Date.parse(aDate)` does not fail — it coerces via
 * `toString()`, whose format carries no milliseconds, so it silently truncates
 * exactly the precision this chain advances by (+1 ms per snapshot). Reading a
 * Date directly keeps the ordering intact.
 */
export function historyMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/**
 * Orchestrates SPAC row writes: append the event, rebuild the row from the
 * append-only deals/events under the `as_of` guard, and snapshot history +
 * ChangeLog when tracked fields change.
 */
export class SpacReportWriter {
  private readonly repo: SpacRepo;
  private readonly mergerExtractions = new SpacMergerExtractionRepo();
  private readonly redemptionExtractions = new SpacRedemptionExtractionRepo();
  private readonly entityRepo: EntityRepo;

  constructor(repo: SpacRepo = new SpacRepo(), entityRepo: EntityRepo = new EntityRepo()) {
    this.repo = repo;
    this.entityRepo = entityRepo;
  }

  async recordRegistration(args: RecordRegistrationArgs): Promise<void> {
    await withCikLock(args.cik, async () => {
      await this.appendEvent({
        cik: args.cik,
        accession_number: args.accession_number,
        event_type: "registration",
        event_date: args.filing_date,
        form: args.form,
        primary_document: args.primary_document,
      });
      await this.rebuild(args.cik, args.filing_date, `${args.form}:${args.accession_number}`, {
        spac_name: args.spac_name,
        spac_sic: args.spac_sic,
        focus: args.focus,
        focus_location: args.focus_location,
        description: args.description,
        team: args.team,
        url_spac: args.url_spac,
      });
    });
  }

  async recordIpo(args: RecordIpoArgs): Promise<void> {
    await withCikLock(args.cik, async () => {
      await this.appendEvent({
        cik: args.cik,
        accession_number: args.accession_number,
        event_type: "ipo",
        event_date: args.filing_date,
        form: args.form,
        primary_document: args.primary_document,
        amount: args.ipo_proceeds,
      });
      await this.rebuild(args.cik, args.filing_date, `${args.form}:${args.accession_number}`, {
        ipo_proceeds: args.ipo_proceeds,
        trust_amount: args.trust_amount,
        spac_tickers:
          args.spac_tickers && args.spac_tickers.length > 0
            ? JSON.stringify(args.spac_tickers)
            : null,
      });
    });
  }

  /**
   * Record de-SPAC milestone events mapped from 8-K item codes: replace every
   * item-mapped type for this accession (PK includes event_type, so a 1.01
   * reclassified from definitive_agreement to material_agreement must drop
   * the old row), then append, recompute deals, and rebuild the row.
   */
  async recordDealMilestones(args: RecordDealMilestonesArgs): Promise<void> {
    if (args.events.length === 0) return;
    await withCikLock(args.cik, async () => {
      for (const event_type of ITEM_MAPPED_EVENT_TYPES) {
        await this.repo.deleteEvent(args.cik, args.accession_number, event_type);
      }
      for (const e of args.events) {
        await this.appendEvent({
          cik: args.cik,
          accession_number: args.accession_number,
          event_type: e.event_type,
          event_date: e.event_date,
          form: args.form,
          primary_document: args.primary_document,
          detail: e.detail ?? null,
        });
      }
      await this.recomputeAndSaveDeals(args.cik);
      await this.rebuild(args.cik, args.filing_date, `${args.form}:${args.accession_number}`, {});
    });
  }

  /**
   * Record a merger proxy: emit a `proxy` event for the definitive proxy
   * (DEFM14A), recompute deals from the event stream + stored merger
   * extractions (correlation derives target/pipe), then rebuild the row. The
   * extraction itself is persisted by the caller (`processMergerProxy`) before
   * this runs.
   */
  async recordMergerProxy(args: RecordMergerProxyArgs): Promise<void> {
    await withCikLock(args.cik, async () => {
      if (args.emitProxyEvent) {
        await this.appendEvent({
          cik: args.cik,
          accession_number: args.accession_number,
          event_type: "proxy",
          event_date: args.filing_date,
          form: args.form,
          primary_document: args.primary_document,
        });
      }
      await this.recomputeAndSaveDeals(args.cik);
      await this.rebuild(args.cik, args.filing_date, `${args.form}:${args.accession_number}`, {});
    });
  }

  /**
   * Record a non-binding letter of intent extracted from a known-SPAC 8-K
   * narrative: append an `loi` event (idempotent by PK), recompute deals (the
   * event walk opens/dates the attempt), then rebuild the row. The extraction
   * itself is persisted by the caller (`processLoi8K`) before this runs.
   */
  async recordLoi(args: {
    readonly cik: number;
    readonly accession_number: string;
    readonly filing_date: string;
    readonly form: string;
    /** LOI date stated in the narrative, else the 8-K report/filing date. */
    readonly event_date: string;
  }): Promise<void> {
    await withCikLock(args.cik, async () => {
      await this.appendEvent({
        cik: args.cik,
        accession_number: args.accession_number,
        event_type: "loi",
        event_date: args.event_date,
        form: args.form,
        primary_document: null,
      });
      await this.recomputeAndSaveDeals(args.cik);
      await this.rebuild(args.cik, args.filing_date, `${args.form}:${args.accession_number}`, {});
    });
  }

  /**
   * Record Exchange listing withdrawal (Form 25 / 25-NSE) or Exchange Act
   * termination (Form 15 / 15F): append a `deregistration` event (idempotent
   * by PK), recompute deals, then rebuild the row. Rollup treats that event as
   * a failure unless a completed de-SPAC already exists.
   */
  async recordDeregistration(args: {
    readonly cik: number;
    readonly accession_number: string;
    readonly filing_date: string;
    readonly form: string;
  }): Promise<void> {
    await withCikLock(args.cik, async () => {
      await this.appendEvent({
        cik: args.cik,
        accession_number: args.accession_number,
        event_type: "deregistration",
        event_date: args.filing_date,
        form: args.form,
        primary_document: null,
      });
      await this.recomputeAndSaveDeals(args.cik);
      await this.rebuild(args.cik, args.filing_date, `${args.form}:${args.accession_number}`, {});
    });
  }

  /**
   * Record a realized redemption: recompute deals from the event stream +
   * stored redemption extractions (correlation derives redemption_amount /
   * redemption_shares onto the matching deal), then rebuild the row. No event
   * is appended — redemptions never advance the lifecycle and an extra event
   * would double-count in the rollup. The extraction itself is persisted by the
   * caller (`processRedemption8K`) before this runs; extraction may have been
   * persisted before any `spac_deal` row existed, in which case `deriveDeals`
   * — which reads the full extraction set on every invocation — automatically
   * correlates the orphan extraction once a later filing mints the deal.
   */
  async recordRedemption(args: {
    readonly cik: number;
    readonly accession_number: string;
    readonly filing_date: string;
    readonly form: string;
  }): Promise<void> {
    await withCikLock(args.cik, async () => {
      await this.recomputeAndSaveDeals(args.cik);
      await this.rebuild(args.cik, args.filing_date, `${args.form}:${args.accession_number}`, {});
    });
  }

  /**
   * De-SPAC linkage: once a SPAC has completed a business combination, link the
   * (now operating) shell to its post-merger identity from the CIK's own
   * post-close entity metadata. In the common case the shell survives legally
   * and keeps its CIK, renaming to the combined company — so `current_cik` stays
   * null (it differs only for the deferred newco/S-4 structures) and the
   * surviving name / SIC / tickers come from the entity + entity_tickers rows.
   *
   * These are **close-time snapshots**, written once: each field is set only
   * when its slot is still empty (or, for `surviving_name`, still holds the
   * deal-target fallback the rollup derives) AND the entity value diverges from
   * the SPAC-era value. So a later replay, `backfill-despac` refresh, or a
   * post-close issuer rebrand cannot mutate an already-populated snapshot, and a
   * ticker set is never populated with SPAC-era symbols. No-ops when the entity
   * metadata has not yet caught up to the rename (post_merger_* stay null until
   * it does). Only enriches a row whose derived status is already `completed`
   * (the 2.01 milestone landed first).
   */
  async recordDeSpacLinkage(args: {
    readonly cik: number;
    readonly accession_number: string;
    readonly filing_date: string;
    readonly form: string;
  }): Promise<void> {
    await withCikLock(args.cik, async () => {
      const existing = await this.repo.getSpac(args.cik);
      if (!existing || existing.status !== "completed") return;
      const [entity, tickers, deals] = await Promise.all([
        this.entityRepo.getEntity(args.cik),
        this.entityRepo.getEntityTickers(args.cik),
        this.repo.getDeals(args.cik),
      ]);
      const patch: {
        surviving_name?: string | null;
        post_merger_sic?: number | null;
        post_merger_tickers?: string | null;
      } = {};
      // Renamed surviving entity: fill from the current entity name once it
      // diverges from the blank-check shell name. Write-once — upgrade the
      // deal-target fallback the rollup derived (or fill an empty slot) exactly
      // once, but never overwrite an already entity-sourced snapshot on a later
      // replay/rebrand.
      // Upgradeable while the slot is empty or still holds the rollup's derived
      // deal-target fallback. Keyed off the recorded source rather than comparing
      // against the CURRENT fallback: a superseding proxy moves `target_name`, and
      // a value-equality check would then mistake the derived name for an
      // entity-sourced snapshot and refuse the upgrade forever.
      const survivingUpgradeable =
        existing.surviving_name == null || existing.surviving_name_source !== "entity";
      if (entity?.name != null && entity.name !== existing.spac_name && survivingUpgradeable) {
        patch.surviving_name = entity.name;
      }
      // Operating-company SIC once it diverges from the SPAC-era ~6770. Write-once.
      if (
        existing.post_merger_sic == null &&
        entity?.sic != null &&
        entity.sic !== existing.spac_sic
      ) {
        patch.post_merger_sic = entity.sic;
      }
      // New listing symbol(s) — JSON string[] mirroring the spac_tickers shape.
      // Write-once, deduped + sorted for determinism, and only when the symbol
      // set diverges from the SPAC-era tickers (never mirror them here).
      if (existing.post_merger_tickers == null) {
        const symbols = [
          ...new Set(tickers.map((t) => t.ticker).filter((s): s is string => !!s)),
        ].sort();
        const spacSymbols = parseTickerArray(existing.spac_tickers);
        if (
          symbols.length > 0 &&
          JSON.stringify(symbols) !== JSON.stringify([...spacSymbols].sort())
        ) {
          patch.post_merger_tickers = JSON.stringify(symbols);
        }
      }
      if (Object.keys(patch).length === 0) return;
      await this.rebuild(
        args.cik,
        args.filing_date,
        `${args.form}:${args.accession_number}`,
        patch
      );
    });
  }

  /**
   * Write editorial fields onto the spac row without disturbing the filing
   * pipeline's temporal machinery. The rebuild is driven at the row's own
   * `as_of` anchor (or "" when the row is new), so the patch applies with
   * overwrite semantics — a re-import can correct an earlier editorial value —
   * while the anchor itself never advances: subsequent filing-driven writes
   * see the same staleness ordering they would have without the editorial
   * write. Survival across replays is structural: no automated `record*`
   * method carries `url_sponsor` / `details`, and the rollup merge never
   * clobbers a non-null value with an absent/null patch field. Creates the
   * row (status `registered`, everything else null) when none exists;
   * callers that must not mint known-SPAC rows check existence first.
   */
  async recordEditorial(args: RecordEditorialArgs): Promise<void> {
    const patch: { url_spac?: string; url_sponsor?: string; details?: string } = {};
    if (args.url_spac !== undefined) patch.url_spac = args.url_spac;
    if (args.url_sponsor !== undefined) patch.url_sponsor = args.url_sponsor;
    if (args.details !== undefined) patch.details = args.details;
    if (Object.keys(patch).length === 0) return;
    await withCikLock(args.cik, async () => {
      const existing = await this.repo.getSpac(args.cik);
      await this.rebuild(args.cik, existing?.as_of ?? "", "editorial", patch);
    });
  }

  /**
   * Lift a company-facts trust balance onto the spac row without moving the
   * filing `as_of` anchor. No-ops when there is no spac row (does not mint a
   * known-SPAC) or when the incoming snapshot is not newer than the one already
   * stored. IPO `trust_amount` is left untouched.
   */
  async recordCurrentTrust(args: {
    readonly cik: number;
    readonly amount: number;
    readonly asOf: string;
    readonly filed: string;
  }): Promise<boolean> {
    return await withCikLock(args.cik, async () => {
      const existing = await this.repo.getSpac(args.cik);
      if (existing == null) return false;
      if (
        !isNewerTrustSnapshot(
          { asOf: args.asOf, filed: args.filed },
          { asOf: existing.current_trust_as_of, filed: existing.current_trust_filed }
        )
      ) {
        return false;
      }
      await this.rebuild(args.cik, existing.as_of ?? "", "companyfacts", {
        current_trust_amount: args.amount,
        current_trust_as_of: args.asOf,
        current_trust_filed: args.filed,
      });
      return true;
    });
  }

  /**
   * Rebuild the deal set from the CIK's full event stream + merger extractions
   * (the single derivation path shared by the 8-K and merger-proxy writers).
   *
   * The delete-orphans + upsert-derived pass runs inside one
   * {@link recomputeSpacDeals} transaction so a crash, AbortSignal, or DB
   * error between the two cannot leave the SPAC report row inconsistent with
   * its derived deals (a stale orphan whose `redemption_amount` continues to
   * roll up was the failure mode without this).
   */
  private async recomputeAndSaveDeals(cik: number): Promise<void> {
    const [events, extractions, redemptions, existingDeals] = await Promise.all([
      this.repo.getEvents(cik),
      this.mergerExtractions.getByCik(cik),
      this.redemptionExtractions.getByCik(cik),
      this.repo.getDeals(cik),
    ]);
    const deals = deriveDeals(cik, events, extractions, redemptions, existingDeals);
    const liveIndexes = new Set(deals.map((d) => d.deal_index));
    const toDelete = existingDeals.filter((d) => !liveIndexes.has(d.deal_index));
    await recomputeSpacDeals({
      dealRepo: this.repo.dealRepository,
      cik,
      toDelete,
      toUpsert: deals,
    });
  }

  private async appendEvent(
    partial: Pick<
      SpacEvent,
      "cik" | "accession_number" | "event_type" | "event_date" | "form" | "primary_document"
    > &
      Partial<SpacEvent>
  ): Promise<void> {
    await this.repo.saveEvent({
      source_document_url: null,
      deal_index: null,
      amount: null,
      shares: null,
      detail: null,
      confidence: null,
      created_at: new Date().toISOString(),
      ...partial,
    });
  }

  private async rebuild(
    cik: number,
    filingDate: string,
    changeSource: string,
    patch: SpacRowPatch
  ): Promise<void> {
    // Per-CIK write serialisation is already provided by `withCikLock` around
    // every public `record*` entry point (which is the only path into rebuild),
    // so no inner lock is needed here.
    const existing = await this.repo.getSpac(cik);
    const [deals, events] = await Promise.all([this.repo.getDeals(cik), this.repo.getEvents(cik)]);
    const next = buildSpacRow({ existing, cik, deals, events, patch, filingDate });
    await this.repo.saveSpac(next);
    await this.snapshot(existing, next, changeSource, filingDate);
  }

  private async snapshot(
    prev: Spac | undefined,
    next: Spac,
    changeSource: string,
    filingDate: string
  ): Promise<void> {
    const changed = TRACKED_FIELDS.filter((f) => (prev ? prev[f] : null) !== next[f]);
    if (changed.length === 0) return;

    // Anchor valid_from to the filing's data (not wall-clock updated_at), then
    // enforce strict monotonicity against every prior history row (closed and
    // open alike). Wall-clock anchors invert the chain under clock skew or DST
    // rollback; comparing only the open row lets a same-instant stale replay
    // back-date past a closed snapshot.
    const history = await this.repo.getHistory(next.cik);
    // Close EVERY open row, not just the first. One open row per CIK is the
    // table's invariant, but `find` silently tolerates a violation and closes
    // only the earliest — so a table that ever grew a second open row keeps one
    // open forever instead of healing. Closing all of them makes the next write
    // repair the table.
    const openRows = history.filter((h) => h.valid_to == null);
    const closedTimes = history
      .filter((h) => h.valid_to != null)
      .flatMap((h) => [historyMs(h.valid_from), historyMs(h.valid_to as string)])
      .filter((n) => Number.isFinite(n));
    const maxClosedTo =
      closedTimes.length > 0 ? Math.max(...closedTimes) : Number.NEGATIVE_INFINITY;
    const openFromTimes = openRows
      .map((h) => historyMs(h.valid_from))
      .filter((n) => Number.isFinite(n));
    const openValidFromMs =
      openFromTimes.length > 0 ? Math.max(...openFromTimes) : Number.NEGATIVE_INFINITY;

    const filingDateMs = filingDate === "" ? 0 : Date.parse(`${filingDate}T00:00:00.000Z`);
    const isStale =
      prev?.as_of != null && prev.as_of !== "" && (filingDate === "" || filingDate < prev.as_of);
    // When stale, `isStale` already guarantees prev.as_of is a non-empty
    // string (the `&&` also narrows it for TS); anchor to it, else to filing.
    const anchorMs =
      isStale && prev?.as_of != null && prev.as_of !== ""
        ? Date.parse(`${prev.as_of}T00:00:00.000Z`)
        : filingDateMs;

    const validFromMs = Math.max(
      Number.isFinite(anchorMs) ? anchorMs : 0,
      Number.isFinite(maxClosedTo) ? maxClosedTo + 1 : Number.NEGATIVE_INFINITY,
      Number.isFinite(openValidFromMs) ? openValidFromMs + 1 : Number.NEGATIVE_INFINITY
    );
    const validFrom = new Date(validFromMs).toISOString();

    for (const open of openRows) {
      await this.repo.saveHistory({ ...open, valid_to: validFrom });
    }
    await this.repo.saveHistory(this.toHistory(next, validFrom, changeSource));

    const changeLog = globalServiceRegistry.get(CHANGE_LOG_REPOSITORY_TOKEN);
    for (const field of changed) {
      await changeLog.put({
        change_id: uuid4(),
        entity_type: "spac",
        entity_id: String(next.cik),
        field_name: String(field),
        old_value: prev ? serialize(prev[field]) : null,
        new_value: serialize(next[field]),
        change_type: prev ? "update" : "create",
        change_source: changeSource,
        change_date: validFrom,
        filing_accession_number: null,
        batch_id: null,
        user_id: null,
        metadata: null,
      });
    }
  }

  private toHistory(row: Spac, validFrom: string, changeSource: string): SpacHistory {
    return {
      cik: row.cik,
      valid_from: validFrom,
      valid_to: null,
      status: row.status,
      current_cik: row.current_cik,
      spac_name: row.spac_name,
      target_name: row.target_name,
      surviving_name: row.surviving_name,
      current_name: row.current_name,
      spac_sic: row.spac_sic,
      post_merger_sic: row.post_merger_sic,
      current_sic: row.current_sic,
      spac_tickers: row.spac_tickers,
      post_merger_tickers: row.post_merger_tickers,
      current_tickers: row.current_tickers,
      ipo_proceeds: row.ipo_proceeds,
      trust_amount: row.trust_amount,
      current_trust_amount: row.current_trust_amount,
      current_trust_as_of: row.current_trust_as_of,
      current_trust_filed: row.current_trust_filed,
      pipe_amount: row.pipe_amount,
      total_redemption_amount: row.total_redemption_amount,
      focus: row.focus,
      focus_location: row.focus_location,
      description: row.description,
      target_description: row.target_description,
      team: row.team,
      details: row.details,
      url_spac: row.url_spac,
      url_sponsor: row.url_sponsor,
      investorpres_url: row.investorpres_url,
      investorpres_date: row.investorpres_date,
      registration_date: row.registration_date,
      ipo_date: row.ipo_date,
      unit_split_date: row.unit_split_date,
      loi_date: row.loi_date,
      definitive_agreement_date: row.definitive_agreement_date,
      proxy_date: row.proxy_date,
      vote_date: row.vote_date,
      completed_date: row.completed_date,
      failed_date: row.failed_date,
      change_source: changeSource,
      change_date: validFrom,
    };
  }
}

function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Parse a JSON-encoded string[] ticker column, tolerating null/garbage as []. */
function parseTickerArray(raw: string | null): string[] {
  if (raw == null || raw === "") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}
