/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SqliteTabularRepository } from "@workglow/storage";
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
import { Address } from "../storage/address/AddressSchema";
import {
  PORTAL_REPOSITORY_TOKEN,
  PortalPrimaryKeyNames,
  PortalSchema,
} from "../storage/portal/PortalSchema";
import { getDb } from "../util/db";

export const DefaultDI = () => {
  // ------------------------------ Addresses --------------------------------
  globalServiceRegistry.registerInstance(
    ADDRESS_REPOSITORY_TOKEN,
    new SqliteTabularRepository<typeof AddressSchema, typeof AddressPrimaryKeyNames, Address>(
      getDb(),
      "addresses",
      AddressSchema,
      AddressPrimaryKeyNames,
      ["city"]
    )
  );
  globalServiceRegistry.registerInstance(
    ADDRESS_JUNCTION_REPOSITORY_TOKEN,
    new SqliteTabularRepository<
      typeof AddressesEntityJunctionSchema,
      typeof AddressJunctionPrimaryKeyNames,
      AddressesEntityJunction
    >(
      getDb(),
      "addresses_entity_junction",
      AddressesEntityJunctionSchema,
      AddressJunctionPrimaryKeyNames,
      [["cik"]]
    )
  );
  // ------------------------------ Persons --------------------------------
  globalServiceRegistry.registerInstance(
    PERSON_REPOSITORY_TOKEN,
    new SqliteTabularRepository<typeof PersonSchema, typeof PersonPrimaryKeyNames, Person>(
      getDb(),
      "persons",
      PersonSchema,
      PersonPrimaryKeyNames,
      [["last", "first"]]
    )
  );
  globalServiceRegistry.registerInstance(
    PERSON_ENTITY_JUNCTION_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "persons_entity_junction",
      PersonsEntityJunctionSchema,
      PersonEntityJunctionPrimaryKeyNames,
      [["cik"]]
    )
  );
  globalServiceRegistry.registerInstance(
    PERSON_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "persons_address_junction",
      PersonsAddressJunctionSchema,
      PersonAddressJunctionPrimaryKeyNames,
      [["address_hash_id"]]
    )
  );
  globalServiceRegistry.registerInstance(
    PERSON_PHONE_JUNCTION_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "persons_phone_junction",
      PersonPhoneJunctionSchema,
      PersonPhoneJunctionPrimaryKeyNames,
      [["international_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    PERSON_PREVIOUS_NAMES_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "persons_previous_names",
      PersonPreviousNamesSchema,
      PersonPreviousNamesPrimaryKeyNames,
      [["person_hash_id"], ["previous_name"]]
    )
  );

  // ------------------------------ Companies --------------------------------
  globalServiceRegistry.registerInstance(
    COMPANY_REPOSITORY_TOKEN,
    new SqliteTabularRepository(getDb(), "companies", CompanySchema, CompanyPrimaryKeyNames, [
      ["company_name"],
    ])
  );
  globalServiceRegistry.registerInstance(
    COMPANY_ENTITY_JUNCTION_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "companies_entity_junction",
      CompaniesEntityJunctionSchema,
      CompanyEntityJunctionPrimaryKeyNames,
      [["cik"]]
    )
  );
  globalServiceRegistry.registerInstance(
    COMPANY_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "companies_address_junction",
      CompaniesAddressJunctionSchema,
      CompanyAddressJunctionPrimaryKeyNames,
      [["address_hash_id"]]
    )
  );
  globalServiceRegistry.registerInstance(
    COMPANY_PHONE_JUNCTION_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "companies_phone_junction",
      CompanyPhoneJunctionSchema,
      CompanyPhoneJunctionPrimaryKeyNames,
      [["international_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    COMPANY_PREVIOUS_NAMES_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "companies_previous_names",
      CompanyPreviousNamesSchema,
      CompanyPreviousNamesPrimaryKeyNames,
      [["company_hash_id"], ["previous_name"]]
    )
  );

  // ------------------------------ Phones --------------------------------
  globalServiceRegistry.registerInstance(
    PHONE_REPOSITORY_TOKEN,
    new SqliteTabularRepository(getDb(), "phones", PhoneSchema, PhonePrimaryKeyNames)
  );
  globalServiceRegistry.registerInstance(
    PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "phones_entity_junction",
      PhonesEntityJunctionSchema,
      PhoneEntityJunctionPrimaryKeyNames,
      [["cik"]]
    )
  );

  // ------------------------------ Investment Offerings --------------------------------
  globalServiceRegistry.registerInstance(
    INVESTMENT_OFFERING_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "investment_offerings",
      InvestmentOfferingSchema,
      InvestmentOfferingPrimaryKeyNames,
      [["industry_group", "industry_subgroup"]]
    )
  );
  globalServiceRegistry.registerInstance(
    INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "investment_offerings_history",
      InvestmentOfferingHistorySchema,
      InvestmentOfferingHistoryPrimaryKeyNames,
      [["accession_number"]]
    )
  );

  // ------------------------------ Issuers --------------------------------
  globalServiceRegistry.registerInstance(
    ISSUER_REPOSITORY_TOKEN,
    new SqliteTabularRepository(getDb(), "issuers", IssuerSchema, IssuerPrimaryKeyNames, [
      ["issuer_cik", "cik"],
    ])
  );

  // ------------------------------ Entities --------------------------------
  globalServiceRegistry.registerInstance(
    ENTITY_REPOSITORY_TOKEN,
    new SqliteTabularRepository(getDb(), "entities", EntitySchema, EntityPrimaryKeyNames, [
      ["name"],
      ["sic"],
    ])
  );
  globalServiceRegistry.registerInstance(
    ENTITY_TICKER_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "entity_tickers",
      EntityTickerSchema,
      EntityTickerPrimaryKeyNames,
      [["ticker", "exchange"], ["cik"]]
    )
  );
  globalServiceRegistry.registerInstance(
    SIC_CODE_REPOSITORY_TOKEN,
    new SqliteTabularRepository(getDb(), "sic_code", SicCodeSchema, SicCodePrimaryKeyNames)
  );
  globalServiceRegistry.registerInstance(
    CIK_NAME_REPOSITORY_TOKEN,
    new SqliteTabularRepository(getDb(), "cik_names", CikNameSchema, CikNamePrimaryKeyNames, [
      ["name"],
    ])
  );

  // ------------------------------ Filings --------------------------------
  globalServiceRegistry.registerInstance(
    FILING_REPOSITORY_TOKEN,
    new SqliteTabularRepository(getDb(), "filings", FilingSchema, FilingPrimaryKeyNames, [
      ["form", "cik"],
      ["filing_date"],
      ["accession_number"],
    ])
  );

  // ------------------------------ Crowdfunding --------------------------------
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "crowdfunding",
      CrowdfundingSchema,
      CrowdfundingPrimaryKeyNames,
      [["portal_cik", "status", "state_jurisdiction"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "crowdfunding_offerings",
      CrowdfundingOfferingsSchema,
      CrowdfundingOfferingsPrimaryKeyNames,
      [["cik", "file_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_REPORTS_REPOSITORY_TOKEN,
    new SqliteTabularRepository(
      getDb(),
      "crowdfunding_reports",
      CrowdfundingReportsSchema,
      CrowdfundingReportsPrimaryKeyNames
    )
  );

  // ------------------------------ Portals --------------------------------
  globalServiceRegistry.registerInstance(
    PORTAL_REPOSITORY_TOKEN,
    new SqliteTabularRepository(getDb(), "portals", PortalSchema, PortalPrimaryKeyNames, [
      ["name"],
      ["brand"],
      ["live"],
    ])
  );
};
