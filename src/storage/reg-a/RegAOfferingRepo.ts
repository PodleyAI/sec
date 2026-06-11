/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  REGA_EQUITY_CLASS_REPOSITORY_TOKEN,
  RegAEquityClass,
  RegAEquityClassRepositoryStorage,
} from "./RegAEquityClassSchema";
import {
  REGA_FINANCIAL_DATA_REPOSITORY_TOKEN,
  RegAFinancialData,
  RegAFinancialDataRepositoryStorage,
} from "./RegAFinancialDataSchema";
import {
  REGA_OFFERING_HISTORY_REPOSITORY_TOKEN,
  RegAOfferingHistory,
  RegAOfferingHistoryRepositoryStorage,
} from "./RegAOfferingHistorySchema";
import {
  REGA_OFFERING_REPOSITORY_TOKEN,
  RegAOffering,
  RegAOfferingRepositoryStorage,
} from "./RegAOfferingSchema";
import {
  REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN,
  RegAServiceProvider,
  RegAServiceProviderRepositoryStorage,
} from "./RegAServiceProviderSchema";

interface RegAOfferingRepoOptions {
  offeringRepository?: RegAOfferingRepositoryStorage;
  offeringHistoryRepository?: RegAOfferingHistoryRepositoryStorage;
  serviceProviderRepository?: RegAServiceProviderRepositoryStorage;
  financialDataRepository?: RegAFinancialDataRepositoryStorage;
  equityClassRepository?: RegAEquityClassRepositoryStorage;
}

/**
 * Reg-A Offering repository - aggregates all Reg-A schemas
 */
export class RegAOfferingRepo {
  readonly offeringRepository: RegAOfferingRepositoryStorage;
  readonly offeringHistoryRepository: RegAOfferingHistoryRepositoryStorage;
  readonly serviceProviderRepository: RegAServiceProviderRepositoryStorage;
  readonly financialDataRepository: RegAFinancialDataRepositoryStorage;
  readonly equityClassRepository: RegAEquityClassRepositoryStorage;

  constructor(options: RegAOfferingRepoOptions = {}) {
    this.offeringRepository =
      options.offeringRepository ?? globalServiceRegistry.get(REGA_OFFERING_REPOSITORY_TOKEN);
    this.offeringHistoryRepository =
      options.offeringHistoryRepository ??
      globalServiceRegistry.get(REGA_OFFERING_HISTORY_REPOSITORY_TOKEN);
    this.serviceProviderRepository =
      options.serviceProviderRepository ??
      globalServiceRegistry.get(REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN);
    this.financialDataRepository =
      options.financialDataRepository ??
      globalServiceRegistry.get(REGA_FINANCIAL_DATA_REPOSITORY_TOKEN);
    this.equityClassRepository =
      options.equityClassRepository ??
      globalServiceRegistry.get(REGA_EQUITY_CLASS_REPOSITORY_TOKEN);
  }

  // ================================
  // Offering Methods
  // ================================

  async getOffering(cik: number, fileNumber: string): Promise<RegAOffering | undefined> {
    return await this.offeringRepository.get({ cik, file_number: fileNumber });
  }

  async saveOffering(offering: RegAOffering): Promise<void> {
    await this.offeringRepository.put(offering);
  }

  async getOfferingsByCik(cik: number): Promise<RegAOffering[]> {
    return (await this.offeringRepository.query({ cik })) || [];
  }

  async getOfferingsByStatus(status: string): Promise<RegAOffering[]> {
    return (await this.offeringRepository.query({ status })) || [];
  }

  async getOfferingsByTier(tier: string): Promise<RegAOffering[]> {
    return (await this.offeringRepository.query({ tier })) || [];
  }

  async countOfferingsByStatus(): Promise<Map<string, number>> {
    const all = (await this.offeringRepository.getAll()) || [];
    const counts = new Map<string, number>();
    for (const o of all) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    return counts;
  }

  async countOfferingsByTier(): Promise<Map<string, number>> {
    const all = (await this.offeringRepository.getAll()) || [];
    const counts = new Map<string, number>();
    for (const o of all) {
      const tier = o.tier ?? "unknown";
      counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Sum of the most recently filed aggregate-offering amount per offering
   * (file_number) for the CIK. Prefers `total_aggregate_offering` (Form 1-A)
   * and falls back to `aggregate_offering_price`; offerings with no history
   * carrying either value contribute nothing.
   */
  async latestAggregateOfferingByCik(cik: number): Promise<number> {
    const offerings = await this.getOfferingsByCik(cik);
    let sum = 0;
    for (const offering of offerings) {
      const histories =
        (await this.offeringHistoryRepository.query({
          cik,
          file_number: offering.file_number,
        })) || [];
      const latest = [...histories]
        .sort((a, b) => b.filing_date.localeCompare(a.filing_date))
        .find((h) => h.total_aggregate_offering !== null || h.aggregate_offering_price !== null);
      if (latest) {
        sum += latest.total_aggregate_offering ?? latest.aggregate_offering_price ?? 0;
      }
    }
    return sum;
  }

  // ================================
  // Offering History Methods
  // ================================

  async getOfferingHistory(
    cik: number,
    fileNumber: string,
    accessionNumber: string
  ): Promise<RegAOfferingHistory | undefined> {
    return await this.offeringHistoryRepository.get({
      cik,
      file_number: fileNumber,
      accession_number: accessionNumber,
    });
  }

  async saveOfferingHistory(history: RegAOfferingHistory): Promise<void> {
    await this.offeringHistoryRepository.put(history);
  }

  async getOfferingHistoriesByFileNumber(fileNumber: string): Promise<RegAOfferingHistory[]> {
    return (await this.offeringHistoryRepository.query({ file_number: fileNumber })) || [];
  }

  // ================================
  // Service Provider Methods
  // ================================

  async saveServiceProvider(provider: RegAServiceProvider): Promise<void> {
    await this.serviceProviderRepository.put(provider);
  }

  async getServiceProvidersByFiling(
    cik: number,
    fileNumber: string,
    accessionNumber: string
  ): Promise<RegAServiceProvider[]> {
    return (
      (await this.serviceProviderRepository.query({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
      })) || []
    );
  }

  // ================================
  // Financial Data Methods
  // ================================

  async saveFinancialData(data: RegAFinancialData): Promise<void> {
    await this.financialDataRepository.put(data);
  }

  async getFinancialDataByFiling(
    cik: number,
    fileNumber: string,
    accessionNumber: string
  ): Promise<RegAFinancialData[]> {
    return (
      (await this.financialDataRepository.query({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
      })) || []
    );
  }

  // ================================
  // Equity Class Methods
  // ================================

  async saveEquityClass(equityClass: RegAEquityClass): Promise<void> {
    await this.equityClassRepository.put(equityClass);
  }

  async getEquityClassesByFiling(
    cik: number,
    fileNumber: string,
    accessionNumber: string
  ): Promise<RegAEquityClass[]> {
    return (
      (await this.equityClassRepository.query({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
      })) || []
    );
  }

  // ================================
  // Convenience Methods
  // ================================

  async getCompleteOfferingData(
    cik: number,
    fileNumber: string,
    accessionNumber: string
  ): Promise<{
    offering: RegAOffering | undefined;
    history: RegAOfferingHistory | undefined;
    serviceProviders: RegAServiceProvider[];
    financialData: RegAFinancialData[];
    equityClasses: RegAEquityClass[];
  }> {
    const [offering, history, serviceProviders, financialData, equityClasses] = await Promise.all([
      this.getOffering(cik, fileNumber),
      this.getOfferingHistory(cik, fileNumber, accessionNumber),
      this.getServiceProvidersByFiling(cik, fileNumber, accessionNumber),
      this.getFinancialDataByFiling(cik, fileNumber, accessionNumber),
      this.getEquityClassesByFiling(cik, fileNumber, accessionNumber),
    ]);
    return { offering, history, serviceProviders, financialData, equityClasses };
  }
}
