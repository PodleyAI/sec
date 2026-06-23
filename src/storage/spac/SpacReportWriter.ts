/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, uuid4 } from "workglow";
import { SpacRepo } from "./SpacRepo";
import { buildSpacRow, type SpacRowPatch } from "./spacRollup";
import type { Spac } from "./SpacSchema";
import type { SpacEvent } from "./SpacEventSchema";
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
      spac_tickers: args.spac_tickers ? JSON.stringify(args.spac_tickers) : null,
    });
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

    const now = next.updated_at;

    // Close the open history row, then append the new snapshot.
    const history = await this.repo.getHistory(next.cik);
    const open = history.find((h) => h.valid_to === null);
    if (open) {
      await this.repo.saveHistory({ ...open, valid_to: now });
    }
    await this.repo.saveHistory(this.toHistory(next, now, changeSource));

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
        change_date: now,
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
