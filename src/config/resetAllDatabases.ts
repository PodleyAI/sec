/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN } from "../storage/address/AddressHistorySchema";
import {
  ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  ADDRESS_REPOSITORY_TOKEN,
} from "../storage/address/AddressSchema";
import { CHANGE_LOG_REPOSITORY_TOKEN } from "../storage/change-tracking/ChangeLogSchema";
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
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../storage/processing/ProcessedSubmissionsSchema";
import { REGA_EQUITY_CLASS_REPOSITORY_TOKEN } from "../storage/reg-a/RegAEquityClassSchema";
import { REGA_FINANCIAL_DATA_REPOSITORY_TOKEN } from "../storage/reg-a/RegAFinancialDataSchema";
import { REGA_OFFERING_HISTORY_REPOSITORY_TOKEN } from "../storage/reg-a/RegAOfferingHistorySchema";
import { REGA_OFFERING_REPOSITORY_TOKEN } from "../storage/reg-a/RegAOfferingSchema";
import { REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN } from "../storage/reg-a/RegAServiceProviderSchema";
import {
  CANONICAL_COMPANY_ALIAS_REPOSITORY_TOKEN,
  CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN,
} from "../storage/canonical/CanonicalAliasSchemas";
import { CANONICAL_COMPANY_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalCompanySchema";
import { FORM_8K_EVENT_REPOSITORY_TOKEN } from "../storage/form-8k-event/Form8KEventSchema";
import {
  CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN,
  CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN,
  CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
  CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN,
} from "../storage/canonical/CanonicalJunctionSchemas";
import { CANONICAL_PERSON_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalPersonSchema";
import { COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN } from "../storage/canonical/CompanyIdentityLinkSchema";
import { PERSON_IDENTITY_LINK_REPOSITORY_TOKEN } from "../storage/canonical/PersonIdentityLinkSchema";
import { COMPANY_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/CompanyObservationSchema";
import { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/PersonObservationSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../storage/versioning/ComponentVersionSchema";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../storage/versioning/ExtractorRunSchema";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "../storage/versioning/VersionEventSchema";

/**
 * Truncates every registered repository. Used by `sec db reset --confirm`
 * before re-running `setupAllDatabases()` to recreate the schema.
 *
 * NOTE: When adding a new repository token in DefaultDI.ts, add its
 * deleteAll() call here so reset doesn't leave orphan rows behind.
 */
export async function resetAllDatabases(): Promise<void> {
  await globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ADDRESS_JUNCTION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PHONE_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(INVESTMENT_OFFERING_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ISSUER_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ENTITY_TICKER_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(SIC_CODE_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CROWDFUNDING_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CROWDFUNDING_REPORTS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CROWDFUNDING_HISTORY_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CHANGE_LOG_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PORTAL_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(REGA_OFFERING_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(REGA_OFFERING_HISTORY_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(REGA_FINANCIAL_DATA_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(REGA_EQUITY_CLASS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PERSON_OBSERVATION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(COMPANY_OBSERVATION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CANONICAL_PERSON_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CANONICAL_COMPANY_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PERSON_IDENTITY_LINK_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CANONICAL_COMPANY_ALIAS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(FORM_8K_EVENT_REPOSITORY_TOKEN).deleteAll();
}
