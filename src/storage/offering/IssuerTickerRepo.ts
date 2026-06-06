/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  ISSUER_TICKER_REPOSITORY_TOKEN,
  type IssuerTicker,
  type IssuerTickerRepositoryStorage,
} from "./IssuerTickerSchema";

export class IssuerTickerRepo {
  private readonly storage: IssuerTickerRepositoryStorage;

  constructor(storage?: IssuerTickerRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(ISSUER_TICKER_REPOSITORY_TOKEN);
  }

  async save(row: IssuerTicker): Promise<void> {
    await this.storage.put(row);
  }

  async clear(accession_number: string): Promise<void> {
    const rows = (await this.storage.query({ accession_number })) ?? [];
    for (const r of rows) {
      await this.storage.delete({
        extractor_id: r.extractor_id,
        accession_number: r.accession_number,
        exchange: r.exchange,
        ticker: r.ticker,
      });
    }
  }

  /** Every symbol the issuer carried, ordered by filing_date (nulls last). */
  async history(cik: number): Promise<IssuerTicker[]> {
    const rows = (await this.storage.query({ cik })) ?? [];
    return rows.sort((a, b) => (a.filing_date ?? "~").localeCompare(b.filing_date ?? "~"));
  }
}
