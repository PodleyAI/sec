/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, uuid4 } from "workglow";
import { SpacRepo } from "./SpacRepo";
import { buildSpacRow, type SpacRowPatch } from "./spacRollup";
import { deriveDeals } from "./spacDealGrouping";
import { SpacMergerExtractionRepo } from "./SpacMergerExtractionRepo";
import { SpacRedemptionExtractionRepo } from "./SpacRedemptionExtractionRepo";
import type { Spac } from "./SpacSchema";
import type { SpacEvent, SpacEventType } from "./SpacEventSchema";
import type { SpacHistory } from "./SpacHistorySchema";
import { CHANGE_LOG_REPOSITORY_TOKEN } from "../change-tracking/ChangeLogSchema";

interface RecordRegistrationArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly form: string;
  readonly primary_document: string | null;
  readonly spac_name: string | null;
  readonly spac_sic: number | null;
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
  readonly events: readonly { event_type: SpacEventType; event_date: string }[];
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

/** Fields compared for ChangeLog/history; everything except the volatile timestamp. */
const TRACKED_FIELDS: readonly (keyof Spac)[] = [
  "current_cik", "status", "spac_name", "target_name", "surviving_name", "current_name",
  "spac_sic", "post_merger_sic", "current_sic", "spac_tickers", "post_merger_tickers",
  "current_tickers", "ipo_proceeds", "trust_amount", "pipe_amount", "total_redemption_amount",
  "registration_date", "ipo_date", "unit_split_date", "definitive_agreement_date", "proxy_date",
  "vote_date", "completed_date", "failed_date",
];

/**
 * Orchestrates SPAC row writes: append the event, rebuild the row from the
 * append-only deals/events under the `as_of` guard, and snapshot history +
 * ChangeLog when tracked fields change.
 */
export class SpacReportWriter {
  private readonly repo: SpacRepo;
  private readonly mergerExtractions = new SpacMergerExtractionRepo();
  private readonly redemptionExtractions = new SpacRedemptionExtractionRepo();

  constructor(repo: SpacRepo = new SpacRepo()) {
    this.repo = repo;
  }

  async recordRegistration(args: RecordRegistrationArgs): Promise<void> {
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
    });
  }

  async recordIpo(args: RecordIpoArgs): Promise<void> {
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
  }

  /**
   * Record de-SPAC milestone events mapped from 8-K item codes: append each
   * event (idempotent by PK), recompute the deal set from the full event
   * stream (merge-preserving §4b-owned columns), then rebuild the row.
   */
  async recordDealMilestones(args: RecordDealMilestonesArgs): Promise<void> {
    if (args.events.length === 0) return;
    for (const e of args.events) {
      await this.appendEvent({
        cik: args.cik,
        accession_number: args.accession_number,
        event_type: e.event_type,
        event_date: e.event_date,
        form: args.form,
        primary_document: args.primary_document,
      });
    }
    await this.recomputeAndSaveDeals(args.cik);
    await this.rebuild(args.cik, args.filing_date, `${args.form}:${args.accession_number}`, {});
  }

  /**
   * Record a merger proxy: emit a `proxy` event for the definitive proxy
   * (DEFM14A), recompute deals from the event stream + stored merger
   * extractions (correlation derives target/pipe), then rebuild the row. The
   * extraction itself is persisted by the caller (`processMergerProxy`) before
   * this runs.
   */
  async recordMergerProxy(args: RecordMergerProxyArgs): Promise<void> {
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
    await this.recomputeAndSaveDeals(args.cik);
    await this.rebuild(args.cik, args.filing_date, `${args.form}:${args.accession_number}`, {});
  }

  /**
   * Rebuild the deal set from the CIK's full event stream + merger extractions
   * (the single derivation path shared by the 8-K and merger-proxy writers).
   */
  private async recomputeAndSaveDeals(cik: number): Promise<void> {
    const [events, extractions, redemptions, existingDeals] = await Promise.all([
      this.repo.getEvents(cik),
      this.mergerExtractions.getByCik(cik),
      this.redemptionExtractions.getByCik(cik),
      this.repo.getDeals(cik),
    ]);
    const deals = deriveDeals(cik, events, extractions, redemptions, existingDeals);
    // Reconcile: if a prior derivation yielded more deals than this one (the
    // event stream or derivation logic changed), delete the orphaned rows.
    // saveDeal only upserts, so without this their stale columns — notably
    // redemption_amount — would still be summed into the rolled-up totals.
    const liveIndexes = new Set(deals.map((d) => d.deal_index));
    for (const existing of existingDeals) {
      if (!liveIndexes.has(existing.deal_index)) {
        await this.repo.deleteDeal(existing.cik, existing.deal_index);
      }
    }
    for (const deal of deals) await this.repo.saveDeal(deal);
  }

  private async appendEvent(
    partial: Pick<SpacEvent, "cik" | "accession_number" | "event_type" | "event_date" | "form" | "primary_document"> &
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
    const existing = await this.repo.getSpac(cik);
    const [deals, events] = await Promise.all([this.repo.getDeals(cik), this.repo.getEvents(cik)]);
    const next = buildSpacRow({ existing, cik, deals, events, patch, filingDate });
    await this.repo.saveSpac(next);
    await this.snapshot(existing, next, changeSource);
  }

  private async snapshot(prev: Spac | undefined, next: Spac, changeSource: string): Promise<void> {
    const changed = TRACKED_FIELDS.filter((f) => (prev ? prev[f] : null) !== next[f]);
    if (changed.length === 0) return;

    // Close the open history row, then append the new snapshot. Guarantee a
    // strictly increasing valid_from: two writes for the same CIK in the same
    // millisecond would otherwise collide on the (cik, valid_from) primary key
    // and the new snapshot would overwrite the just-closed row, losing history.
    const history = await this.repo.getHistory(next.cik);
    const open = history.find((h) => h.valid_to == null);
    let validFrom = next.updated_at;
    if (open && validFrom <= open.valid_from) {
      validFrom = new Date(Date.parse(open.valid_from) + 1).toISOString();
    }
    if (open) {
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
      pipe_amount: row.pipe_amount,
      total_redemption_amount: row.total_redemption_amount,
      registration_date: row.registration_date,
      ipo_date: row.ipo_date,
      unit_split_date: row.unit_split_date,
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
