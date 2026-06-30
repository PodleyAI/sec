/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { KeyedMutex } from "../../util/KeyedMutex";
import { isStaleByAsOf } from "../../util/asOfGuard";
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
 * Serialises the read-guard-write of the mutable current Reg-A offering row per
 * `(cik, file_number)`. Module-scoped because every caller builds a fresh
 * {@link RegAOfferingRepo}. The ` ` separator never occurs in an EDGAR file
 * number, so distinct keys can't collide.
 */
const regAOfferingWriteLock = new KeyedMutex<string>();

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

  /**
   * Persist the mutable current Reg-A offering row under an `as_of` staleness
   * guard, atomically. Reads the existing row, skips the write when the incoming
   * `filing_date` is older than the stored `as_of` (an out-of-order amendment —
   * see {@link isStaleByAsOf}), and otherwise writes the row `build` returns.
   * `build` receives the row read inside the lock so a 1-K / 1-Z (which carry no
   * tier / SIC / audit data) can merge those fields forward from the 1-A instead
   * of clobbering them with nulls.
   *
   * The whole read-merge-write runs inside a per-`(cik, file_number)` lock so a
   * 1-A and a 1-K / 1-Z for the same offering processed concurrently (forms map
   * over a CIK's filings with `concurrencyLimit` 5/10) cannot both read the same
   * prior row and lost-update it.
   */
  async saveOfferingAsOf(
    cik: number,
    fileNumber: string,
    filing_date: string,
    build: (existing: RegAOffering | undefined) => RegAOffering
  ): Promise<void> {
    await regAOfferingWriteLock.lock(`${cik} ${fileNumber}`, async () => {
      const existing = await this.getOffering(cik, fileNumber);
      if (isStaleByAsOf(existing?.as_of, filing_date)) return;
      await this.saveOffering(build(existing));
    });
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

  /**
   * Statuses the Reg-A extractors write: 1-A -> pending, 1-K -> reporting,
   * 1-Z -> exit. Rows with any other status are reported under "other" by
   * {@link countOfferingsByStatus}.
   */
  static readonly OFFERING_STATUSES = ["pending", "reporting", "exit"] as const;

  static readonly OFFERING_TIERS = ["Tier1", "Tier2"] as const;

  /**
   * Buckets offerings by a column using one pushed-down count() per known
   * value plus a residual derived from the total (criteria pushdown has no
   * IS NULL form, so null values and unexpected labels land in the residual).
   */
  private async countBuckets(
    column: "status" | "tier",
    known: readonly string[],
    residualLabel: string,
    cik: number | undefined
  ): Promise<Map<string, number>> {
    const base = cik === undefined ? {} : { cik };
    const [total, ...perValue] = await Promise.all([
      this.offeringRepository.count(base),
      ...known.map((value) => this.offeringRepository.count({ ...base, [column]: value })),
    ]);
    const counts = new Map<string, number>();
    let knownSum = 0;
    for (let i = 0; i < known.length; i++) {
      if (perValue[i] > 0) counts.set(known[i], perValue[i]);
      knownSum += perValue[i];
    }
    if (total > knownSum) counts.set(residualLabel, total - knownSum);
    return counts;
  }

  async countOfferingsByStatus(cik?: number): Promise<Map<string, number>> {
    return this.countBuckets("status", RegAOfferingRepo.OFFERING_STATUSES, "other", cik);
  }

  async countOfferingsByTier(cik?: number): Promise<Map<string, number>> {
    return this.countBuckets("tier", RegAOfferingRepo.OFFERING_TIERS, "unknown", cik);
  }

  async countOfferings(cik?: number): Promise<number> {
    return this.offeringRepository.count(cik === undefined ? {} : { cik });
  }

  /**
   * Sum of the most recently filed aggregate-offering amount per offering
   * (file_number) for the CIK. Prefers `total_aggregate_offering` (Form 1-A)
   * and falls back to `aggregate_offering_price`. Returns null when no
   * history row carries either value, so callers can distinguish "no data"
   * from a genuine $0. Ties on filing_date (e.g. a same-day amendment) break
   * on the higher accession_number for determinism.
   */
  async latestAggregateOfferingByCik(cik: number): Promise<number | null> {
    const histories = (await this.offeringHistoryRepository.query({ cik })) || [];
    const latestByOffering = new Map<string, RegAOfferingHistory>();
    for (const h of histories) {
      if (h.total_aggregate_offering == null && h.aggregate_offering_price == null) continue;
      const current = latestByOffering.get(h.file_number);
      if (
        !current ||
        h.filing_date.localeCompare(current.filing_date) > 0 ||
        (h.filing_date === current.filing_date &&
          h.accession_number.localeCompare(current.accession_number) > 0)
      ) {
        latestByOffering.set(h.file_number, h);
      }
    }
    if (latestByOffering.size === 0) return null;
    let sum = 0;
    for (const h of latestByOffering.values()) {
      sum += h.total_aggregate_offering ?? h.aggregate_offering_price ?? 0;
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
