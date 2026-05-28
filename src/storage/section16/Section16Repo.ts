/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  Section16Filing,
  Section16FilingRepositoryStorage,
  Section16Holding,
  Section16HoldingRepositoryStorage,
  Section16Transaction,
  Section16TransactionRepositoryStorage,
  SECTION16_FILING_REPOSITORY_TOKEN,
  SECTION16_HOLDING_REPOSITORY_TOKEN,
  SECTION16_TRANSACTION_REPOSITORY_TOKEN,
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

  async saveHolding(holding: Section16Holding): Promise<void> {
    await this.holdingRepository.put(holding);
  }

  async getHoldings(accession_number: string): Promise<Section16Holding[]> {
    return (await this.holdingRepository.query({ accession_number })) || [];
  }
}
