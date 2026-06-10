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
   * Idempotent re-extract: clears any facts already stored for the filing
   * (a re-run may yield fewer facts, so stale high indexes must go) and bulk
   * writes the new rows.
   */
  async replaceForAccession(accession_number: string, rows: readonly XbrlFactRow[]): Promise<void> {
    const existing = (await this.storage.query({ accession_number })) ?? [];
    for (const row of existing) {
      await this.storage.delete({
        accession_number: row.accession_number,
        fact_index: row.fact_index,
      });
    }
    if (rows.length > 0) await this.storage.putBulk([...rows]);
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
    const rows = (await this.storage.query({ cik })) ?? [];
    return rows
      .filter((r) => r.concept === concept)
      .sort(
        (a, b) =>
          a.accession_number.localeCompare(b.accession_number) || a.fact_index - b.fact_index
      );
  }
}
