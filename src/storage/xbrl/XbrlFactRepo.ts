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
   */
  async replaceForAccession(accession_number: string, rows: readonly XbrlFactRow[]): Promise<void> {
    if (rows.length > 0) await this.storage.putBulk([...rows]);
    const keep = new Set(rows.map((r) => r.fact_index));
    const existing = (await this.storage.query({ accession_number })) ?? [];
    for (const r of existing) {
      if (!keep.has(r.fact_index)) {
        await this.storage.delete({ accession_number, fact_index: r.fact_index });
      }
    }
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
