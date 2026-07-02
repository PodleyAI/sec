/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  XBRL_FACT_REPOSITORY_TOKEN,
  type XbrlFactRow,
  type XbrlFactRepositoryStorage,
} from "./XbrlFactSchema";

export class XbrlFactRepo {
  private readonly storage: XbrlFactRepositoryStorage;

  constructor(storage?: XbrlFactRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(XBRL_FACT_REPOSITORY_TOKEN);
  }

  /**
   * Idempotent re-extract that never leaves the filing with zero facts. Writes
   * the new rows FIRST (an upsert by the `(accession_number, fact_index)` PK),
   * THEN deletes any rows a prior, longer extract left whose `fact_index` the
   * new set does not include.
   *
   * The previous order — delete-all, then `putBulk` — wiped every fact for the
   * filing if the `putBulk` then failed (e.g. a schema/maxLength rejection of one
   * row aborts the batch), and the "never throws" caller masked that loss as a
   * `NO_XBRL` success. Writing first means a `putBulk` failure throws before any
   * delete, leaving the prior facts intact; the stale-tail delete only runs once
   * the new rows are committed. There is no surrounding transaction (the storage
   * abstraction exposes none), so the worst residual case — a failure during the
   * stale-tail delete — leaves a superset of facts, which the next re-extract
   * cleans up, rather than data loss.
   *
   * A 0-row input is refused by default: a parser regression, disabled XBRL,
   * or a degrade path returning `[]` would otherwise wipe every prior fact for
   * the filing. Callers that genuinely want to purge (an operator forcing a
   * reset) pass `intentionalClear: true`, or call {@link clearForAccession}.
   */
  async replaceForAccession(
    accession_number: string,
    rows: readonly XbrlFactRow[],
    opts: { readonly intentionalClear?: boolean } = {}
  ): Promise<void> {
    if (rows.length === 0 && !opts.intentionalClear) {
      console.warn(
        `XbrlFactRepo.replaceForAccession: 0 rows for ${accession_number} without intentionalClear — no-op`
      );
      return;
    }
    if (rows.length > 0) await this.storage.putBulk([...rows]);
    const keep = new Set(rows.map((r) => r.fact_index));
    const existing = (await this.storage.query({ accession_number })) ?? [];
    for (const r of existing) {
      if (!keep.has(r.fact_index)) {
        await this.storage.delete({ accession_number, fact_index: r.fact_index });
      }
    }
  }

  /**
   * Unconditionally deletes every fact for the given accession. The explicit
   * purge path — use when an operator is intentionally resetting a filing.
   */
  async clearForAccession(accession_number: string): Promise<void> {
    // Empty rows + intentionalClear reuses the single delete implementation in
    // replaceForAccession (keep-set empty → every fact deleted).
    await this.replaceForAccession(accession_number, [], { intentionalClear: true });
  }

  /** All facts for a filing in extraction order. */
  async getByAccession(accession_number: string): Promise<XbrlFactRow[]> {
    const rows = (await this.storage.query({ accession_number })) ?? [];
    return rows.sort((a, b) => a.fact_index - b.fact_index);
  }

  async countByAccession(accession_number: string): Promise<number> {
    const rows = (await this.storage.query({ accession_number })) ?? [];
    return rows.length;
  }

  /** Facts for one concept across an issuer's filings (e.g. trust balance over time). */
  async getByCikConcept(cik: number, concept: string): Promise<XbrlFactRow[]> {
    const rows = (await this.storage.query({ cik, concept })) ?? [];
    return rows.sort(
      (a, b) => a.accession_number.localeCompare(b.accession_number) || a.fact_index - b.fact_index
    );
  }
}
