/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  Form144Acquisition,
  Form144AcquisitionRepositoryStorage,
  Form144Filing,
  Form144FilingRepositoryStorage,
  Form144RecentSale,
  Form144RecentSaleRepositoryStorage,
  FORM144_ACQUISITION_REPOSITORY_TOKEN,
  FORM144_FILING_REPOSITORY_TOKEN,
  FORM144_RECENT_SALE_REPOSITORY_TOKEN,
} from "./Form144Schema";

interface Form144RepoOptions {
  filingRepository?: Form144FilingRepositoryStorage;
  acquisitionRepository?: Form144AcquisitionRepositoryStorage;
  recentSaleRepository?: Form144RecentSaleRepositoryStorage;
}

/**
 * Repository for Form 144 notices: the filing header (including the proposed
 * sale), the acquisition lots, and the trailing-3-month sales.
 */
export class Form144Repo implements Form144RepoOptions {
  filingRepository: Form144FilingRepositoryStorage;
  acquisitionRepository: Form144AcquisitionRepositoryStorage;
  recentSaleRepository: Form144RecentSaleRepositoryStorage;

  constructor(options: Form144RepoOptions = {}) {
    this.filingRepository =
      options.filingRepository ?? globalServiceRegistry.get(FORM144_FILING_REPOSITORY_TOKEN);
    this.acquisitionRepository =
      options.acquisitionRepository ??
      globalServiceRegistry.get(FORM144_ACQUISITION_REPOSITORY_TOKEN);
    this.recentSaleRepository =
      options.recentSaleRepository ??
      globalServiceRegistry.get(FORM144_RECENT_SALE_REPOSITORY_TOKEN);
  }

  async saveFiling(filing: Form144Filing): Promise<void> {
    await this.filingRepository.put(filing);
  }

  async getFiling(accession_number: string): Promise<Form144Filing | undefined> {
    return this.filingRepository.get({ accession_number });
  }

  async saveAcquisition(acquisition: Form144Acquisition): Promise<void> {
    await this.acquisitionRepository.put(acquisition);
  }

  async getAcquisitions(accession_number: string): Promise<Form144Acquisition[]> {
    return (await this.acquisitionRepository.query({ accession_number })) || [];
  }

  /**
   * Removes every acquisition row for a filing. Rows are keyed by a positional
   * `(accession_number, acquisition_index)`, so re-extracting a filing that now
   * yields fewer rows would otherwise leave stale orphans at the higher
   * indices. Callers clear before re-inserting to stay idempotent.
   */
  async clearAcquisitions(accession_number: string): Promise<void> {
    const rows = (await this.acquisitionRepository.query({ accession_number })) || [];
    for (const row of rows) {
      await this.acquisitionRepository.delete({
        accession_number,
        acquisition_index: row.acquisition_index,
      });
    }
  }

  async saveRecentSale(sale: Form144RecentSale): Promise<void> {
    await this.recentSaleRepository.put(sale);
  }

  async getRecentSales(accession_number: string): Promise<Form144RecentSale[]> {
    return (await this.recentSaleRepository.query({ accession_number })) || [];
  }

  /** Removes every trailing-3-month sale row for a filing; see {@link clearAcquisitions}. */
  async clearRecentSales(accession_number: string): Promise<void> {
    const rows = (await this.recentSaleRepository.query({ accession_number })) || [];
    for (const row of rows) {
      await this.recentSaleRepository.delete({ accession_number, sale_index: row.sale_index });
    }
  }
}
