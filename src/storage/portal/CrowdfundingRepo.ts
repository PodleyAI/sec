//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { globalServiceRegistry } from "@podley/util";
import {
  Crowdfunding,
  CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN,
  CROWDFUNDING_REPORTS_REPOSITORY_TOKEN,
  CROWDFUNDING_REPOSITORY_TOKEN,
  CrowdfundingOfferings,
  CrowdfundingOfferingsRepositoryStorage,
  CrowdfundingReports,
  CrowdfundingReportsRepositoryStorage,
  CrowdfundingRepositoryStorage,
} from "./CrowdfundingSchema";

// Options for the CrowdfundingRepo
interface CrowdfundingRepoOptions {
  crowdfundingRepository?: CrowdfundingRepositoryStorage;
  crowdfundingOfferingsRepository?: CrowdfundingOfferingsRepositoryStorage;
  crowdfundingReportsRepository?: CrowdfundingReportsRepositoryStorage;
}

/**
 * Crowdfunding repository - handles crowdfunding entities, offerings, and reports
 */
export class CrowdfundingRepo implements CrowdfundingRepoOptions {
  crowdfundingRepository: CrowdfundingRepositoryStorage;
  crowdfundingOfferingsRepository: CrowdfundingOfferingsRepositoryStorage;
  crowdfundingReportsRepository: CrowdfundingReportsRepositoryStorage;

  constructor(options: CrowdfundingRepoOptions = {}) {
    this.crowdfundingRepository =
      options.crowdfundingRepository ?? globalServiceRegistry.get(CROWDFUNDING_REPOSITORY_TOKEN);
    this.crowdfundingOfferingsRepository =
      options.crowdfundingOfferingsRepository ??
      globalServiceRegistry.get(CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN);
    this.crowdfundingReportsRepository =
      options.crowdfundingReportsRepository ??
      globalServiceRegistry.get(CROWDFUNDING_REPORTS_REPOSITORY_TOKEN);
  }

  // Crowdfunding methods
  async getCrowdfunding(cik: number, fileNumber: string): Promise<Crowdfunding | undefined> {
    return await this.crowdfundingRepository.get({ cik, file_number: fileNumber });
  }

  async saveCrowdfunding(crowdfunding: Crowdfunding): Promise<void> {
    await this.crowdfundingRepository.put(crowdfunding);
  }

  async searchCrowdfunding(criteria: Partial<Crowdfunding>): Promise<Crowdfunding[]> {
    return (await this.crowdfundingRepository.search(criteria)) || [];
  }

  async getAllCrowdfunding(): Promise<Crowdfunding[]> {
    return (await this.crowdfundingRepository.getAll()) || [];
  }

  async getCrowdfundingByCik(cik: number): Promise<Crowdfunding[]> {
    return (await this.crowdfundingRepository.search({ cik })) || [];
  }

  async getCrowdfundingByPortalCik(portalCik: number): Promise<Crowdfunding[]> {
    return (await this.crowdfundingRepository.search({ portal_cik: portalCik })) || [];
  }

  async getCrowdfundingByStatus(status: string): Promise<Crowdfunding[]> {
    return (await this.crowdfundingRepository.search({ status })) || [];
  }

  // Crowdfunding Offerings methods
  async getCrowdfundingOffering(
    cik: number,
    fileNumber: string,
    filingDate: string
  ): Promise<CrowdfundingOfferings | undefined> {
    return await this.crowdfundingOfferingsRepository.get({
      cik,
      file_number: fileNumber,
      filing_date: filingDate,
    });
  }

  async saveCrowdfundingOffering(offering: CrowdfundingOfferings): Promise<void> {
    await this.crowdfundingOfferingsRepository.put(offering);
  }

  async searchCrowdfundingOfferings(
    criteria: Partial<CrowdfundingOfferings>
  ): Promise<CrowdfundingOfferings[]> {
    return (await this.crowdfundingOfferingsRepository.search(criteria)) || [];
  }

  async getAllCrowdfundingOfferings(): Promise<CrowdfundingOfferings[]> {
    return (await this.crowdfundingOfferingsRepository.getAll()) || [];
  }

  async getCrowdfundingOfferingsByCik(cik: number): Promise<CrowdfundingOfferings[]> {
    return (await this.crowdfundingOfferingsRepository.search({ cik })) || [];
  }

  async getCrowdfundingOfferingsByFileNumber(fileNumber: string): Promise<CrowdfundingOfferings[]> {
    return (await this.crowdfundingOfferingsRepository.search({ file_number: fileNumber })) || [];
  }

  // Crowdfunding Reports methods
  async getCrowdfundingReport(
    cik: number,
    fileNumber: string,
    filingDate: string,
    disclosureName: string
  ): Promise<CrowdfundingReports | undefined> {
    return await this.crowdfundingReportsRepository.get({
      cik,
      file_number: fileNumber,
      filing_date: filingDate,
      disclosure_name: disclosureName,
    });
  }

  async saveCrowdfundingReport(report: CrowdfundingReports): Promise<void> {
    await this.crowdfundingReportsRepository.put(report);
  }

  async searchCrowdfundingReports(
    criteria: Partial<CrowdfundingReports>
  ): Promise<CrowdfundingReports[]> {
    return (await this.crowdfundingReportsRepository.search(criteria)) || [];
  }

  async getAllCrowdfundingReports(): Promise<CrowdfundingReports[]> {
    return (await this.crowdfundingReportsRepository.getAll()) || [];
  }

  async getCrowdfundingReportsByCik(cik: number): Promise<CrowdfundingReports[]> {
    return (await this.crowdfundingReportsRepository.search({ cik })) || [];
  }

  async getCrowdfundingReportsByFileNumber(fileNumber: string): Promise<CrowdfundingReports[]> {
    return (await this.crowdfundingReportsRepository.search({ file_number: fileNumber })) || [];
  }

  // Convenience methods
  async getCrowdfundingWithOfferings(
    cik: number,
    fileNumber: string
  ): Promise<{
    crowdfunding: Crowdfunding | undefined;
    offerings: CrowdfundingOfferings[];
  }> {
    const [crowdfunding, offerings] = await Promise.all([
      this.getCrowdfunding(cik, fileNumber),
      this.getCrowdfundingOfferingsByFileNumber(fileNumber),
    ]);
    return { crowdfunding, offerings };
  }

  async getCrowdfundingWithReports(
    cik: number,
    fileNumber: string
  ): Promise<{
    crowdfunding: Crowdfunding | undefined;
    reports: CrowdfundingReports[];
  }> {
    const [crowdfunding, reports] = await Promise.all([
      this.getCrowdfunding(cik, fileNumber),
      this.getCrowdfundingReportsByFileNumber(fileNumber),
    ]);
    return { crowdfunding, reports };
  }

  async getCompleteCrowdfundingData(
    cik: number,
    fileNumber: string
  ): Promise<{
    crowdfunding: Crowdfunding | undefined;
    offerings: CrowdfundingOfferings[];
    reports: CrowdfundingReports[];
  }> {
    const [crowdfunding, offerings, reports] = await Promise.all([
      this.getCrowdfunding(cik, fileNumber),
      this.getCrowdfundingOfferingsByFileNumber(fileNumber),
      this.getCrowdfundingReportsByFileNumber(fileNumber),
    ]);
    return { crowdfunding, offerings, reports };
  }
}
