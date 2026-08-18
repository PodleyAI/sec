/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  SECTION16_FILING_REPOSITORY_TOKEN,
  SECTION16_HOLDING_REPOSITORY_TOKEN,
  SECTION16_TRANSACTION_REPOSITORY_TOKEN,
  Section16Filing,
  Section16FilingRepositoryStorage,
  Section16Holding,
  Section16HoldingRepositoryStorage,
  Section16Transaction,
  Section16TransactionRepositoryStorage,
} from "./Section16Schema";

interface Section16RepoOptions {
  filingRepository?: Section16FilingRepositoryStorage;
  transactionRepository?: Section16TransactionRepositoryStorage;
  holdingRepository?: Section16HoldingRepositoryStorage;
}

/**
 * Repository for Section 16 ownership filings (Forms 3/4/5): the filing
 * header, its transactions, and its holdings.
 */
export class Section16Repo implements Section16RepoOptions {
  filingRepository: Section16FilingRepositoryStorage;
  transactionRepository: Section16TransactionRepositoryStorage;
  holdingRepository: Section16HoldingRepositoryStorage;

  constructor(options: Section16RepoOptions = {}) {
    this.filingRepository =
      options.filingRepository ?? globalServiceRegistry.get(SECTION16_FILING_REPOSITORY_TOKEN);
    this.transactionRepository =
      options.transactionRepository ??
      globalServiceRegistry.get(SECTION16_TRANSACTION_REPOSITORY_TOKEN);
    this.holdingRepository =
      options.holdingRepository ?? globalServiceRegistry.get(SECTION16_HOLDING_REPOSITORY_TOKEN);
  }

  async saveFiling(filing: Section16Filing): Promise<void> {
    await this.filingRepository.put(filing);
  }

  async getFiling(accession_number: string): Promise<Section16Filing | undefined> {
    return this.filingRepository.get({ accession_number });
  }

  async saveTransaction(transaction: Section16Transaction): Promise<void> {
    await this.transactionRepository.put(transaction);
  }

  async getTransactions(accession_number: string): Promise<Section16Transaction[]> {
    return (await this.transactionRepository.query({ accession_number })) || [];
  }

  /**
   * Removes every transaction row for a filing. Transactions are keyed by a
   * positional `(accession_number, transaction_index)`, so re-extracting a
   * filing that now yields fewer rows would otherwise leave stale orphans at
   * the higher indices. Callers clear before re-inserting to stay idempotent.
   */
  async clearTransactions(accession_number: string): Promise<void> {
    const rows = (await this.transactionRepository.query({ accession_number })) || [];
    for (const row of rows) {
      await this.transactionRepository.delete({
        accession_number,
        transaction_index: row.transaction_index,
      });
    }
  }

  async saveHolding(holding: Section16Holding): Promise<void> {
    await this.holdingRepository.put(holding);
  }

  async getHoldings(accession_number: string): Promise<Section16Holding[]> {
    return (await this.holdingRepository.query({ accession_number })) || [];
  }

  /** Removes every holding row for a filing; see {@link clearTransactions}. */
  async clearHoldings(accession_number: string): Promise<void> {
    const rows = (await this.holdingRepository.query({ accession_number })) || [];
    for (const row of rows) {
      await this.holdingRepository.delete({ accession_number, holding_index: row.holding_index });
    }
  }

  /**
   * Distinct `issuer_trading_symbol` values on Forms 3/4/5 filed on or before
   * `onOrBefore`. Used when a priced prospectus never wrote an issuer_ticker
   * row — IPO-day Form 3s still carry the SPAC-era symbol (WAVS), while later
   * post-combination Form 4s (CYCU) are excluded by the date bound.
   */
  async tradingSymbolsOnOrBefore(issuer_cik: number, onOrBefore: string): Promise<string[]> {
    const rows = (await this.filingRepository.query({ issuer_cik })) || [];
    const seen = new Set<string>();
    const symbols: string[] = [];
    for (const row of rows) {
      if (row.filing_date == null || row.filing_date > onOrBefore) continue;
      const symbol = row.issuer_trading_symbol?.trim().toUpperCase();
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      symbols.push(symbol);
    }
    return symbols;
  }
}
