/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "@workglow/util";
import {
  ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  ADDRESS_REPOSITORY_TOKEN,
  AddressesEntityJunction,
  AddressesEntityJunctionSchema,
  AddressJunctionPrimaryKeyNames,
  AddressPrimaryKeyNames,
  AddressSchema,
} from "../storage/address/AddressSchema";
import {
  CompaniesAddressJunctionSchema,
  CompaniesEntityJunctionSchema,
  COMPANY_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  COMPANY_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  COMPANY_PHONE_JUNCTION_REPOSITORY_TOKEN,
  COMPANY_PREVIOUS_NAMES_REPOSITORY_TOKEN,
  COMPANY_REPOSITORY_TOKEN,
  CompanyAddressJunctionPrimaryKeyNames,
  CompanyEntityJunctionPrimaryKeyNames,
  CompanyPhoneJunctionPrimaryKeyNames,
  CompanyPhoneJunctionSchema,
  CompanyPreviousNamesPrimaryKeyNames,
  CompanyPreviousNamesSchema,
  CompanyPrimaryKeyNames,
  CompanySchema,
} from "../storage/company/CompanySchema";
import {
  ENTITY_REPOSITORY_TOKEN,
  EntityPrimaryKeyNames,
  EntitySchema,
} from "../storage/entity/EntitySchema";
import {
  ENTITY_TICKER_REPOSITORY_TOKEN,
  EntityTickerPrimaryKeyNames,
  EntityTickerSchema,
} from "../storage/entity/EntityTickerSchema";
import {
  SIC_CODE_REPOSITORY_TOKEN,
  SicCodePrimaryKeyNames,
  SicCodeSchema,
} from "../storage/entity/SicCodeSchema";
import {
  CIK_NAME_REPOSITORY_TOKEN,
  CikNamePrimaryKeyNames,
  CikNameSchema,
} from "../storage/entity/CikNameSchema";
import {
  FILING_REPOSITORY_TOKEN,
  FilingPrimaryKeyNames,
  FilingSchema,
} from "../storage/filing/FilingSchema";
import {
  INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN,
  InvestmentOfferingHistoryPrimaryKeyNames,
  InvestmentOfferingHistorySchema,
} from "../storage/investment-offering/InvestmentOfferingHistorySchema";
import {
  INVESTMENT_OFFERING_REPOSITORY_TOKEN,
  InvestmentOfferingPrimaryKeyNames,
  InvestmentOfferingSchema,
} from "../storage/investment-offering/InvestmentOfferingSchema";
import {
  ISSUER_REPOSITORY_TOKEN,
  IssuerPrimaryKeyNames,
  IssuerSchema,
} from "../storage/investment-offering/IssuerSchema";
import {
  PERSON_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  PERSON_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  PERSON_PHONE_JUNCTION_REPOSITORY_TOKEN,
  PERSON_PREVIOUS_NAMES_REPOSITORY_TOKEN,
  PERSON_REPOSITORY_TOKEN,
  PersonAddressJunctionPrimaryKeyNames,
  PersonEntityJunctionPrimaryKeyNames,
  PersonPhoneJunctionPrimaryKeyNames,
  PersonPhoneJunctionSchema,
  PersonPreviousNamesPrimaryKeyNames,
  PersonPreviousNamesSchema,
  PersonPrimaryKeyNames,
  PersonsAddressJunctionSchema,
  Person,
  PersonSchema,
  PersonsEntityJunctionSchema,
} from "../storage/person/PersonSchema";
import {
  PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  PHONE_REPOSITORY_TOKEN,
  PhoneEntityJunctionPrimaryKeyNames,
  PhonePrimaryKeyNames,
  PhoneSchema,
  PhonesEntityJunctionSchema,
} from "../storage/phone/PhoneSchema";
import {
  CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN,
  CROWDFUNDING_REPORTS_REPOSITORY_TOKEN,
  CROWDFUNDING_REPOSITORY_TOKEN,
  CrowdfundingOfferingsPrimaryKeyNames,
  CrowdfundingOfferingsSchema,
  CrowdfundingPrimaryKeyNames,
  CrowdfundingReportsPrimaryKeyNames,
  CrowdfundingReportsSchema,
  CrowdfundingSchema,
} from "../storage/portal/CrowdfundingSchema";
import {
  CROWDFUNDING_HISTORY_REPOSITORY_TOKEN,
  CrowdfundingHistoryPrimaryKeyNames,
  CrowdfundingHistorySchema,
} from "../storage/portal/CrowdfundingHistorySchema";
import {
  CHANGE_LOG_REPOSITORY_TOKEN,
  ChangeLogPrimaryKeyNames,
  ChangeLogSchema,
} from "../storage/change-tracking/ChangeLogSchema";
import { Address } from "../storage/address/AddressSchema";
import {
  PORTAL_REPOSITORY_TOKEN,
  PortalPrimaryKeyNames,
  PortalSchema,
} from "../storage/portal/PortalSchema";
import {
  REGA_OFFERING_REPOSITORY_TOKEN,
  RegAOfferingPrimaryKeyNames,
  RegAOfferingSchema,
} from "../storage/reg-a/RegAOfferingSchema";
import {
  REGA_OFFERING_HISTORY_REPOSITORY_TOKEN,
  RegAOfferingHistoryPrimaryKeyNames,
  RegAOfferingHistorySchema,
} from "../storage/reg-a/RegAOfferingHistorySchema";
import {
  REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN,
  RegAServiceProviderPrimaryKeyNames,
  RegAServiceProviderSchema,
} from "../storage/reg-a/RegAServiceProviderSchema";
import {
  REGA_FINANCIAL_DATA_REPOSITORY_TOKEN,
  RegAFinancialDataPrimaryKeyNames,
  RegAFinancialDataSchema,
} from "../storage/reg-a/RegAFinancialDataSchema";
import {
  REGA_EQUITY_CLASS_REPOSITORY_TOKEN,
  RegAEquityClassPrimaryKeyNames,
  RegAEquityClassSchema,
} from "../storage/reg-a/RegAEquityClassSchema";
import {
  FORM_8K_EVENT_REPOSITORY_TOKEN,
  Form8KEventPrimaryKeyNames,
  Form8KEventSchema,
} from "../storage/form-8k-event/Form8KEventSchema";
import {
  CIK_LAST_UPDATE_REPOSITORY_TOKEN,
  CikLastUpdatePrimaryKeyNames,
  CikLastUpdateSchema,
} from "../storage/processing/CikLastUpdateSchema";
import {
  PROCESSED_FACTS_REPOSITORY_TOKEN,
  ProcessedFactsPrimaryKeyNames,
  ProcessedFactsSchema,
} from "../storage/processing/ProcessedFactsSchema";
import {
  PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN,
  ProcessedSubmissionsPrimaryKeyNames,
  ProcessedSubmissionsSchema,
} from "../storage/processing/ProcessedSubmissionsSchema";
import {
  PROCESSED_FILINGS_REPOSITORY_TOKEN,
  ProcessedFilingsPrimaryKeyNames,
  ProcessedFilingsSchema,
} from "../storage/processing/ProcessedFilingsSchema";
import {
  COMPANY_FACTS_REPOSITORY_TOKEN,
  CompanyFactsPrimaryKeyNames,
  CompanyFactsSchema,
} from "../storage/facts/CompanyFactsSchema";
import { createStorage } from "./createStorage";

export const DefaultDI = () => {
  // ------------------------------ Addresses --------------------------------
  globalServiceRegistry.registerInstance(
    ADDRESS_REPOSITORY_TOKEN,
    createStorage<typeof AddressSchema, typeof AddressPrimaryKeyNames, Address>(
      "addresses",
      AddressSchema,
      AddressPrimaryKeyNames,
      ["city"]
    )
  );
  globalServiceRegistry.registerInstance(
    ADDRESS_JUNCTION_REPOSITORY_TOKEN,
    createStorage<
      typeof AddressesEntityJunctionSchema,
      typeof AddressJunctionPrimaryKeyNames,
      AddressesEntityJunction
    >(
      "addresses_entity_junction",
      AddressesEntityJunctionSchema,
      AddressJunctionPrimaryKeyNames,
      [["cik"]]
    )
  );
  // ------------------------------ Persons --------------------------------
  globalServiceRegistry.registerInstance(
    PERSON_REPOSITORY_TOKEN,
    createStorage<typeof PersonSchema, typeof PersonPrimaryKeyNames, Person>(
      "persons",
      PersonSchema,
      PersonPrimaryKeyNames,
      [["last", "first"]]
    )
  );
  globalServiceRegistry.registerInstance(
    PERSON_ENTITY_JUNCTION_REPOSITORY_TOKEN,
    createStorage(
      "persons_entity_junction",
      PersonsEntityJunctionSchema,
      PersonEntityJunctionPrimaryKeyNames,
      [["cik"]]
    )
  );
  globalServiceRegistry.registerInstance(
    PERSON_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
    createStorage(
      "persons_address_junction",
      PersonsAddressJunctionSchema,
      PersonAddressJunctionPrimaryKeyNames,
      [["address_hash_id"]]
    )
  );
  globalServiceRegistry.registerInstance(
    PERSON_PHONE_JUNCTION_REPOSITORY_TOKEN,
    createStorage(
      "persons_phone_junction",
      PersonPhoneJunctionSchema,
      PersonPhoneJunctionPrimaryKeyNames,
      [["international_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    PERSON_PREVIOUS_NAMES_REPOSITORY_TOKEN,
    createStorage(
      "persons_previous_names",
      PersonPreviousNamesSchema,
      PersonPreviousNamesPrimaryKeyNames,
      [["person_hash_id"], ["previous_name"]]
    )
  );

  // ------------------------------ Companies --------------------------------
  globalServiceRegistry.registerInstance(
    COMPANY_REPOSITORY_TOKEN,
    createStorage("companies", CompanySchema, CompanyPrimaryKeyNames, [["company_name"]])
  );
  globalServiceRegistry.registerInstance(
    COMPANY_ENTITY_JUNCTION_REPOSITORY_TOKEN,
    createStorage(
      "companies_entity_junction",
      CompaniesEntityJunctionSchema,
      CompanyEntityJunctionPrimaryKeyNames,
      [["cik"]]
    )
  );
  globalServiceRegistry.registerInstance(
    COMPANY_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
    createStorage(
      "companies_address_junction",
      CompaniesAddressJunctionSchema,
      CompanyAddressJunctionPrimaryKeyNames,
      [["address_hash_id"]]
    )
  );
  globalServiceRegistry.registerInstance(
    COMPANY_PHONE_JUNCTION_REPOSITORY_TOKEN,
    createStorage(
      "companies_phone_junction",
      CompanyPhoneJunctionSchema,
      CompanyPhoneJunctionPrimaryKeyNames,
      [["international_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    COMPANY_PREVIOUS_NAMES_REPOSITORY_TOKEN,
    createStorage(
      "companies_previous_names",
      CompanyPreviousNamesSchema,
      CompanyPreviousNamesPrimaryKeyNames,
      [["company_hash_id"], ["previous_name"]]
    )
  );

  // ------------------------------ Phones --------------------------------
  globalServiceRegistry.registerInstance(
    PHONE_REPOSITORY_TOKEN,
    createStorage("phones", PhoneSchema, PhonePrimaryKeyNames)
  );
  globalServiceRegistry.registerInstance(
    PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN,
    createStorage(
      "phones_entity_junction",
      PhonesEntityJunctionSchema,
      PhoneEntityJunctionPrimaryKeyNames,
      [["cik"]]
    )
  );

  // ------------------------------ Investment Offerings --------------------------------
  globalServiceRegistry.registerInstance(
    INVESTMENT_OFFERING_REPOSITORY_TOKEN,
    createStorage(
      "investment_offerings",
      InvestmentOfferingSchema,
      InvestmentOfferingPrimaryKeyNames,
      [["industry_group", "industry_subgroup"]]
    )
  );
  globalServiceRegistry.registerInstance(
    INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN,
    createStorage(
      "investment_offerings_history",
      InvestmentOfferingHistorySchema,
      InvestmentOfferingHistoryPrimaryKeyNames,
      [["accession_number"]]
    )
  );

  // ------------------------------ Issuers --------------------------------
  globalServiceRegistry.registerInstance(
    ISSUER_REPOSITORY_TOKEN,
    createStorage("issuers", IssuerSchema, IssuerPrimaryKeyNames, [["issuer_cik", "cik"]])
  );

  // ------------------------------ Entities --------------------------------
  globalServiceRegistry.registerInstance(
    ENTITY_REPOSITORY_TOKEN,
    createStorage("entities", EntitySchema, EntityPrimaryKeyNames, [["name"], ["sic"]])
  );
  globalServiceRegistry.registerInstance(
    ENTITY_TICKER_REPOSITORY_TOKEN,
    createStorage("entity_tickers", EntityTickerSchema, EntityTickerPrimaryKeyNames, [
      ["ticker", "exchange"],
      ["cik"],
    ])
  );
  globalServiceRegistry.registerInstance(
    SIC_CODE_REPOSITORY_TOKEN,
    createStorage("sic_code", SicCodeSchema, SicCodePrimaryKeyNames)
  );
  globalServiceRegistry.registerInstance(
    CIK_NAME_REPOSITORY_TOKEN,
    createStorage("cik_names", CikNameSchema, CikNamePrimaryKeyNames, [["name"]])
  );

  // ------------------------------ Filings --------------------------------
  globalServiceRegistry.registerInstance(
    FILING_REPOSITORY_TOKEN,
    createStorage("filings", FilingSchema, FilingPrimaryKeyNames, [
      ["form", "cik"],
      ["filing_date"],
      ["accession_number"],
    ])
  );

  // ------------------------------ Crowdfunding --------------------------------
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_REPOSITORY_TOKEN,
    createStorage("crowdfunding", CrowdfundingSchema, CrowdfundingPrimaryKeyNames, [
      ["portal_cik", "status", "state_jurisdiction"],
    ])
  );
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN,
    createStorage(
      "crowdfunding_offerings",
      CrowdfundingOfferingsSchema,
      CrowdfundingOfferingsPrimaryKeyNames,
      [["cik", "file_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_REPORTS_REPOSITORY_TOKEN,
    createStorage(
      "crowdfunding_reports",
      CrowdfundingReportsSchema,
      CrowdfundingReportsPrimaryKeyNames
    )
  );

  // ------------------------------ Crowdfunding History --------------------------------
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_HISTORY_REPOSITORY_TOKEN,
    createStorage(
      "crowdfunding_history",
      CrowdfundingHistorySchema,
      CrowdfundingHistoryPrimaryKeyNames,
      [["cik", "file_number"]]
    )
  );

  // ------------------------------ Change Log --------------------------------
  globalServiceRegistry.registerInstance(
    CHANGE_LOG_REPOSITORY_TOKEN,
    createStorage("change_log", ChangeLogSchema, ChangeLogPrimaryKeyNames, [
      ["entity_type", "entity_id"],
    ])
  );

  // ------------------------------ Portals --------------------------------
  globalServiceRegistry.registerInstance(
    PORTAL_REPOSITORY_TOKEN,
    createStorage("portals", PortalSchema, PortalPrimaryKeyNames, [
      ["name"],
      ["brand"],
      ["live"],
    ])
  );

  // ------------------------------ Processing Tracking --------------------------------
  globalServiceRegistry.registerInstance(
    CIK_LAST_UPDATE_REPOSITORY_TOKEN,
    createStorage("cik_last_update", CikLastUpdateSchema, CikLastUpdatePrimaryKeyNames)
  );
  globalServiceRegistry.registerInstance(
    PROCESSED_FACTS_REPOSITORY_TOKEN,
    createStorage("processed_facts", ProcessedFactsSchema, ProcessedFactsPrimaryKeyNames, [
      ["last_processed"],
    ])
  );
  globalServiceRegistry.registerInstance(
    PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN,
    createStorage(
      "processed_submissions",
      ProcessedSubmissionsSchema,
      ProcessedSubmissionsPrimaryKeyNames,
      [["last_processed"]]
    )
  );
  globalServiceRegistry.registerInstance(
    PROCESSED_FILINGS_REPOSITORY_TOKEN,
    createStorage("processed_filings", ProcessedFilingsSchema, ProcessedFilingsPrimaryKeyNames, [
      ["last_processed", "success", "form"],
    ])
  );

  // ------------------------------ Company Facts --------------------------------
  globalServiceRegistry.registerInstance(
    COMPANY_FACTS_REPOSITORY_TOKEN,
    createStorage("company_facts", CompanyFactsSchema, CompanyFactsPrimaryKeyNames, [
      ["cik", "name"],
    ])
  );

  // ------------------------------ Reg-A Offerings --------------------------------
  globalServiceRegistry.registerInstance(
    REGA_OFFERING_REPOSITORY_TOKEN,
    createStorage("rega_offerings", RegAOfferingSchema, RegAOfferingPrimaryKeyNames, [
      ["status", "tier"],
    ])
  );
  globalServiceRegistry.registerInstance(
    REGA_OFFERING_HISTORY_REPOSITORY_TOKEN,
    createStorage(
      "rega_offering_history",
      RegAOfferingHistorySchema,
      RegAOfferingHistoryPrimaryKeyNames,
      [["cik", "file_number"], ["file_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN,
    createStorage(
      "rega_service_providers",
      RegAServiceProviderSchema,
      RegAServiceProviderPrimaryKeyNames,
      [["cik", "file_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    REGA_FINANCIAL_DATA_REPOSITORY_TOKEN,
    createStorage(
      "rega_financial_data",
      RegAFinancialDataSchema,
      RegAFinancialDataPrimaryKeyNames,
      [["cik", "file_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    REGA_EQUITY_CLASS_REPOSITORY_TOKEN,
    createStorage("rega_equity_classes", RegAEquityClassSchema, RegAEquityClassPrimaryKeyNames, [
      ["cik", "file_number"],
    ])
  );

  // ------------------------------ Form 8-K Events --------------------------------
  globalServiceRegistry.registerInstance(
    FORM_8K_EVENT_REPOSITORY_TOKEN,
    createStorage("form_8k_events", Form8KEventSchema, Form8KEventPrimaryKeyNames, [
      ["cik", "filing_date"],
      ["item_code"],
      ["cik", "accession_number"],
    ])
  );
};
