/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN } from "../storage/address/AddressHistorySchema";
import {
  ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  ADDRESS_REPOSITORY_TOKEN,
} from "../storage/address/AddressSchema";
import { CHANGE_LOG_REPOSITORY_TOKEN } from "../storage/change-tracking/ChangeLogSchema";
import {
  COMPANY_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  COMPANY_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  COMPANY_PHONE_JUNCTION_REPOSITORY_TOKEN,
  COMPANY_PREVIOUS_NAMES_REPOSITORY_TOKEN,
  COMPANY_REPOSITORY_TOKEN,
} from "../storage/company/CompanySchema";
import { CIK_NAME_REPOSITORY_TOKEN } from "../storage/entity/CikNameSchema";
import { ENTITY_HISTORY_REPOSITORY_TOKEN } from "../storage/entity/EntityHistorySchema";
import { ENTITY_REPOSITORY_TOKEN } from "../storage/entity/EntitySchema";
import { ENTITY_TICKER_REPOSITORY_TOKEN } from "../storage/entity/EntityTickerSchema";
import { SIC_CODE_REPOSITORY_TOKEN } from "../storage/entity/SicCodeSchema";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../storage/facts/CompanyFactsSchema";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN } from "../storage/investment-offering/InvestmentOfferingHistorySchema";
import { INVESTMENT_OFFERING_REPOSITORY_TOKEN } from "../storage/investment-offering/InvestmentOfferingSchema";
import { ISSUER_REPOSITORY_TOKEN } from "../storage/investment-offering/IssuerSchema";
import {
  PERSON_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  PERSON_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  PERSON_PHONE_JUNCTION_REPOSITORY_TOKEN,
  PERSON_PREVIOUS_NAMES_REPOSITORY_TOKEN,
  PERSON_REPOSITORY_TOKEN,
} from "../storage/person/PersonSchema";
import {
  PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  PHONE_REPOSITORY_TOKEN,
} from "../storage/phone/PhoneSchema";
import { CROWDFUNDING_HISTORY_REPOSITORY_TOKEN } from "../storage/portal/CrowdfundingHistorySchema";
import {
  CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN,
  CROWDFUNDING_REPORTS_REPOSITORY_TOKEN,
  CROWDFUNDING_REPOSITORY_TOKEN,
} from "../storage/portal/CrowdfundingSchema";
import { PORTAL_REPOSITORY_TOKEN } from "../storage/portal/PortalSchema";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../storage/processing/CikLastUpdateSchema";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "../storage/processing/ProcessedFactsSchema";
import { PROCESSED_FILINGS_REPOSITORY_TOKEN } from "../storage/processing/ProcessedFilingsSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../storage/processing/ProcessedSubmissionsSchema";
import { REGA_EQUITY_CLASS_REPOSITORY_TOKEN } from "../storage/reg-a/RegAEquityClassSchema";
import { REGA_FINANCIAL_DATA_REPOSITORY_TOKEN } from "../storage/reg-a/RegAFinancialDataSchema";
import { REGA_OFFERING_HISTORY_REPOSITORY_TOKEN } from "../storage/reg-a/RegAOfferingHistorySchema";
import { REGA_OFFERING_REPOSITORY_TOKEN } from "../storage/reg-a/RegAOfferingSchema";
import { REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN } from "../storage/reg-a/RegAServiceProviderSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../storage/versioning/ComponentVersionSchema";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../storage/versioning/ExtractorRunSchema";

/**
 * Calls setupDatabase() on all registered repository instances,
 * creating tables and indexes from their TypeBox schemas.
 *
 * NOTE: When adding a new repository token in DefaultDI.ts, you must also
 * add its setupDatabase() call here or the table will not be created.
 */
export async function setupAllDatabases(): Promise<void> {
  await globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ADDRESS_JUNCTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PERSON_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PERSON_ENTITY_JUNCTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PERSON_ADDRESS_JUNCTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PERSON_PHONE_JUNCTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PERSON_PREVIOUS_NAMES_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(COMPANY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(COMPANY_ENTITY_JUNCTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(COMPANY_ADDRESS_JUNCTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(COMPANY_PHONE_JUNCTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(COMPANY_PREVIOUS_NAMES_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PHONE_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(INVESTMENT_OFFERING_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ISSUER_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ENTITY_TICKER_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SIC_CODE_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CROWDFUNDING_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CROWDFUNDING_REPORTS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CROWDFUNDING_HISTORY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CHANGE_LOG_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PORTAL_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(REGA_OFFERING_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(REGA_OFFERING_HISTORY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(REGA_FINANCIAL_DATA_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(REGA_EQUITY_CLASS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PROCESSED_FILINGS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN).setupDatabase();
}
