/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { isStaleByAsOf } from "../../util/asOfGuard";
import { KeyedMutex } from "../../util/KeyedMutex";
import {
  INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN,
  InvestmentOfferingHistory,
  InvestmentOfferingHistoryRepositoryStorage,
} from "./InvestmentOfferingHistorySchema";
import {
  INVESTMENT_OFFERING_REPOSITORY_TOKEN,
  InvestmentOffering,
  InvestmentOfferingRepositoryStorage,
} from "./InvestmentOfferingSchema";

/**
 * Serialises the read-guard-write of the mutable current offering row per
 * `(cik, file_number)`. Module-scoped because every caller builds a fresh
 * {@link InvestmentOfferingRepo}, so an instance field would not serialise
 * across them. The ` ` separator never occurs in an EDGAR file number, so
 * distinct keys can't collide.
 */
const offeringWriteLock = new KeyedMutex<string>();

// Options for the InvestmentOfferingRepo
interface InvestmentOfferingRepoOptions {
  investmentOfferingRepository?: InvestmentOfferingRepositoryStorage;
  investmentOfferingHistoryRepository?: InvestmentOfferingHistoryRepositoryStorage;
}

/**
 * Investment Offering repository - manages both main offerings and their historical data
 */
export class InvestmentOfferingRepo implements InvestmentOfferingRepoOptions {
  readonly investmentOfferingRepository: InvestmentOfferingRepositoryStorage;
  readonly investmentOfferingHistoryRepository: InvestmentOfferingHistoryRepositoryStorage;

  constructor(options: InvestmentOfferingRepoOptions = {}) {
    this.investmentOfferingRepository =
      options.investmentOfferingRepository ??
      globalServiceRegistry.get(INVESTMENT_OFFERING_REPOSITORY_TOKEN);
    this.investmentOfferingHistoryRepository =
      options.investmentOfferingHistoryRepository ??
      globalServiceRegistry.get(INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN);
  }

  // ================================
  // Investment Offering Methods
  // ================================

  async getInvestmentOffering(
    cik: number,
    file_number: string
  ): Promise<InvestmentOffering | undefined> {
    return await this.investmentOfferingRepository.get({ cik, file_number });
  }

  async saveInvestmentOffering(offering: InvestmentOffering): Promise<InvestmentOffering> {
    await this.investmentOfferingRepository.put(offering);
    return offering;
  }

  /**
   * Persist the mutable current offering row under an `as_of` staleness guard,
   * atomically. Reads the existing row, skips the write when the incoming
   * `filing_date` is older than the stored `as_of` (an out-of-order older D /
   * D-A — see {@link isStaleByAsOf}), and otherwise writes the row `build`
   * returns. `build` receives the row read inside the lock so it can carry the
   * prior `as_of` forward (Form D fully restates the rest, so it needs no other
   * field merge).
   *
   * The whole read-guard-write runs inside a per-`(cik, file_number)` lock so two
   * filings for the same offering processed concurrently (the form tasks map over
   * a CIK's filings with `concurrencyLimit` 5/10) cannot both read the same prior
   * row and let the older filing's write land last — the lost-update the bare
   * guard could not prevent. Mirrors {@link SpacReportWriter}'s per-CIK lock.
   */
  async saveInvestmentOfferingAsOf(
    cik: number,
    file_number: string,
    filing_date: string,
    build: (existing: InvestmentOffering | undefined) => InvestmentOffering
  ): Promise<void> {
    await offeringWriteLock.lock(`${cik} ${file_number}`, async () => {
      const existing = await this.getInvestmentOffering(cik, file_number);
      if (isStaleByAsOf(existing?.as_of, filing_date)) return;
      await this.saveInvestmentOffering(build(existing));
    });
  }

  async getInvestmentOfferingsByCik(cik: number): Promise<InvestmentOffering[]> {
    return (await this.investmentOfferingRepository.query({ cik })) || [];
  }

  async getInvestmentOfferingsByIndustryGroup(
    industry_group: string
  ): Promise<InvestmentOffering[]> {
    return (await this.investmentOfferingRepository.query({ industry_group })) || [];
  }

  async getInvestmentOfferingsByIndustrySubgroup(
    industry_subgroup: string
  ): Promise<InvestmentOffering[]> {
    return (await this.investmentOfferingRepository.query({ industry_subgroup })) || [];
  }

  async getInvestmentOfferingsBySecurityType(
    securityTypeField: keyof Pick<
      InvestmentOffering,
      | "is_debt_type"
      | "is_equity_type"
      | "is_mineral_property_type"
      | "is_option_to_aquire_type"
      | "is_pooled_investment_type"
      | "is_security_to_be_aquired"
      | "is_tenant_in_common"
      | "is_business_combination_type"
      | "is_other_type"
    >,
    value: boolean
  ): Promise<InvestmentOffering[]> {
    const searchCriteria: any = {};
    searchCriteria[securityTypeField] = value;
    return (await this.investmentOfferingRepository.query(searchCriteria)) || [];
  }

  async searchInvestmentOfferings(
    searchCriteria: Partial<InvestmentOffering>
  ): Promise<InvestmentOffering[]> {
    // If no search criteria provided, return all
    if (Object.keys(searchCriteria).length === 0) {
      return (await this.investmentOfferingRepository.getAll()) || [];
    }

    return (await this.investmentOfferingRepository.query(searchCriteria)) || [];
  }

  async getAllInvestmentOfferings(): Promise<InvestmentOffering[]> {
    return (await this.investmentOfferingRepository.getAll()) || [];
  }

  // ================================
  // Investment Offering History Methods
  // ================================

  async getInvestmentOfferingHistory(
    cik: number,
    file_number: string,
    accession_number: string
  ): Promise<InvestmentOfferingHistory | undefined> {
    return await this.investmentOfferingHistoryRepository.get({
      cik,
      file_number,
      accession_number,
    });
  }

  async saveInvestmentOfferingHistory(
    offeringHistory: InvestmentOfferingHistory
  ): Promise<InvestmentOfferingHistory> {
    await this.investmentOfferingHistoryRepository.put(offeringHistory);
    return offeringHistory;
  }

  async getInvestmentOfferingHistoriesByCik(cik: number): Promise<InvestmentOfferingHistory[]> {
    return (await this.investmentOfferingHistoryRepository.query({ cik })) || [];
  }

  async getInvestmentOfferingHistoriesByFileNumber(
    file_number: string
  ): Promise<InvestmentOfferingHistory[]> {
    return (await this.investmentOfferingHistoryRepository.query({ file_number })) || [];
  }

  async getInvestmentOfferingHistoriesByCikAndFileNumber(
    cik: number,
    file_number: string
  ): Promise<InvestmentOfferingHistory[]> {
    return (await this.investmentOfferingHistoryRepository.query({ cik, file_number })) || [];
  }

  async getInvestmentOfferingHistoriesByAccessionNumber(
    accession_number: string
  ): Promise<InvestmentOfferingHistory[]> {
    return (await this.investmentOfferingHistoryRepository.query({ accession_number })) || [];
  }

  /**
   * Get offering histories where minimum investment is above a threshold
   */
  async getInvestmentOfferingHistoriesWithMinimumInvestmentAbove(
    threshold: number
  ): Promise<InvestmentOfferingHistory[]> {
    const allHistories = await this.getAllInvestmentOfferingHistories();
    return allHistories.filter(
      (history) =>
        history.minimum_investment_accepted !== null &&
        history.minimum_investment_accepted > threshold
    );
  }

  /**
   * Get offering histories where total offering amount is above a threshold
   */
  async getInvestmentOfferingHistoriesWithTotalOfferingAbove(
    threshold: number
  ): Promise<InvestmentOfferingHistory[]> {
    const allHistories = await this.getAllInvestmentOfferingHistories();
    return allHistories.filter(
      (history) =>
        history.total_offering_amount !== null && history.total_offering_amount > threshold
    );
  }

  /**
   * Get offering histories where investor count is above a threshold
   */
  async getInvestmentOfferingHistoriesWithInvestorCountAbove(
    threshold: number
  ): Promise<InvestmentOfferingHistory[]> {
    const allHistories = await this.getAllInvestmentOfferingHistories();
    return allHistories.filter(
      (history) => history.investor_count !== null && history.investor_count > threshold
    );
  }

  /**
   * Get offering histories that have non-accredited investors
   */
  async getInvestmentOfferingHistoriesWithNonAccreditedInvestors(): Promise<
    InvestmentOfferingHistory[]
  > {
    const allHistories = await this.getAllInvestmentOfferingHistories();
    return allHistories.filter(
      (history) => history.non_accredited_count !== null && history.non_accredited_count > 0
    );
  }

  async searchInvestmentOfferingHistories(
    searchCriteria: Partial<InvestmentOfferingHistory>
  ): Promise<InvestmentOfferingHistory[]> {
    // If no search criteria provided, return all
    if (Object.keys(searchCriteria).length === 0) {
      return (await this.investmentOfferingHistoryRepository.getAll()) || [];
    }

    return (await this.investmentOfferingHistoryRepository.query(searchCriteria)) || [];
  }

  async getAllInvestmentOfferingHistories(): Promise<InvestmentOfferingHistory[]> {
    return (await this.investmentOfferingHistoryRepository.getAll()) || [];
  }

  // ================================
  // Convenience Methods
  // ================================

  async getInvestmentOfferingWithHistory(
    cik: number,
    file_number: string
  ): Promise<{
    offering: InvestmentOffering | undefined;
    history: InvestmentOfferingHistory[];
  }> {
    const [offering, history] = await Promise.all([
      this.getInvestmentOffering(cik, file_number),
      this.getInvestmentOfferingHistoriesByCikAndFileNumber(cik, file_number),
    ]);
    return { offering, history };
  }

  /**
   * Save both an investment offering and its history in a single transaction-like operation
   */
  async saveInvestmentOfferingWithHistory(
    offering: InvestmentOffering,
    history: InvestmentOfferingHistory
  ): Promise<{ offering: InvestmentOffering; history: InvestmentOfferingHistory }> {
    // Validate that the offering and history are for the same entity and file number
    if (offering.cik !== history.cik || offering.file_number !== history.file_number) {
      throw new Error("Investment offering and history must have matching CIK and file number");
    }

    const [savedOffering, savedHistory] = await Promise.all([
      this.saveInvestmentOffering(offering),
      this.saveInvestmentOfferingHistory(history),
    ]);

    return { offering: savedOffering, history: savedHistory };
  }
}
