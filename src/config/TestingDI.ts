//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InMemoryTabularRepository } from "@podley/storage";
import { globalServiceRegistry } from "@podley/util";
import {
  ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  ADDRESS_REPOSITORY_TOKEN,
  AddressJunctionPrimaryKeyNames,
  AddressPrimaryKeyNames,
  AddressSchema,
  AddressesEntityJunctionSchema,
} from "../storage/address/AddressSchema";
import {
  COMPANY_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  COMPANY_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  COMPANY_PHONE_JUNCTION_REPOSITORY_TOKEN,
  COMPANY_PREVIOUS_NAMES_REPOSITORY_TOKEN,
  COMPANY_REPOSITORY_TOKEN,
  CompaniesAddressJunctionSchema,
  CompaniesEntityJunctionSchema,
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
  PersonSchema,
  PersonsAddressJunctionSchema,
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
  PORTAL_REPOSITORY_TOKEN,
  PortalPrimaryKeyNames,
  PortalSchema,
} from "../storage/portal/PortalSchema";

export function resetDependencyInjectionsForTesting() {
  // Initialize Company repositories
  globalServiceRegistry.registerInstance(
    COMPANY_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(CompanySchema, CompanyPrimaryKeyNames, ["company_name"])
  );
  globalServiceRegistry.registerInstance(
    COMPANY_ENTITY_JUNCTION_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(
      CompaniesEntityJunctionSchema,
      CompanyEntityJunctionPrimaryKeyNames,
      [["relation_name"], ["cik"]]
    )
  );
  globalServiceRegistry.registerInstance(
    COMPANY_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(
      CompaniesAddressJunctionSchema,
      CompanyAddressJunctionPrimaryKeyNames,
      [["relation_name"], ["address_hash_id"]]
    )
  );
  globalServiceRegistry.registerInstance(
    COMPANY_PHONE_JUNCTION_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(CompanyPhoneJunctionSchema, CompanyPhoneJunctionPrimaryKeyNames, [
      ["relation_name"],
      ["international_number"],
    ])
  );
  globalServiceRegistry.registerInstance(
    COMPANY_PREVIOUS_NAMES_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(CompanyPreviousNamesSchema, CompanyPreviousNamesPrimaryKeyNames, [
      ["company_hash_id"],
      ["previous_name"],
    ])
  );

  // Initialize Person repositories
  globalServiceRegistry.registerInstance(
    PERSON_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(PersonSchema, PersonPrimaryKeyNames, ["first", "last"])
  );
  globalServiceRegistry.registerInstance(
    PERSON_ENTITY_JUNCTION_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(
      PersonsEntityJunctionSchema,
      PersonEntityJunctionPrimaryKeyNames,
      [["relation_name"], ["cik"]]
    )
  );
  globalServiceRegistry.registerInstance(
    PERSON_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(
      PersonsAddressJunctionSchema,
      PersonAddressJunctionPrimaryKeyNames,
      [["relation_name"], ["address_hash_id"]]
    )
  );
  globalServiceRegistry.registerInstance(
    PERSON_PHONE_JUNCTION_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(PersonPhoneJunctionSchema, PersonPhoneJunctionPrimaryKeyNames, [
      ["relation_name"],
      ["international_number"],
    ])
  );
  globalServiceRegistry.registerInstance(
    PERSON_PREVIOUS_NAMES_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(PersonPreviousNamesSchema, PersonPreviousNamesPrimaryKeyNames, [
      ["person_hash_id"],
      ["previous_name"],
    ])
  );

  // Initialize Address repositories
  globalServiceRegistry.registerInstance(
    ADDRESS_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(AddressSchema, AddressPrimaryKeyNames, ["city"])
  );
  globalServiceRegistry.registerInstance(
    ADDRESS_JUNCTION_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(AddressesEntityJunctionSchema, AddressJunctionPrimaryKeyNames, [
      ["relation_name"],
      ["cik"],
    ])
  );

  // Initialize Phone repositories
  globalServiceRegistry.registerInstance(
    PHONE_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(PhoneSchema, PhonePrimaryKeyNames, [])
  );
  globalServiceRegistry.registerInstance(
    PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(PhonesEntityJunctionSchema, PhoneEntityJunctionPrimaryKeyNames, [
      ["relation_name"],
      ["cik"],
    ])
  );

  // Initialize Investment Offering repositories
  globalServiceRegistry.registerInstance(
    INVESTMENT_OFFERING_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(InvestmentOfferingSchema, InvestmentOfferingPrimaryKeyNames, [
      ["cik"],
      ["industry_group"],
    ])
  );
  globalServiceRegistry.registerInstance(
    INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(
      InvestmentOfferingHistorySchema,
      InvestmentOfferingHistoryPrimaryKeyNames,
      [["cik"], ["file_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    ISSUER_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(IssuerSchema, IssuerPrimaryKeyNames, [["cik"], ["issuer_cik"]])
  );

  // Initialize Entity repositories
  globalServiceRegistry.registerInstance(
    ENTITY_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(EntitySchema, EntityPrimaryKeyNames, [["name"], ["sic"]])
  );
  globalServiceRegistry.registerInstance(
    ENTITY_TICKER_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(EntityTickerSchema, EntityTickerPrimaryKeyNames, [
      ["ticker", "exchange"],
      ["cik"],
    ])
  );
  globalServiceRegistry.registerInstance(
    SIC_CODE_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(SicCodeSchema, SicCodePrimaryKeyNames, [])
  );
  globalServiceRegistry.registerInstance(
    CIK_NAME_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(CikNameSchema, CikNamePrimaryKeyNames, [["name"]])
  );

  // Initialize Filing repositories
  globalServiceRegistry.registerInstance(
    FILING_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(FilingSchema, FilingPrimaryKeyNames, [
      ["form", "cik"],
      ["filing_date"],
      ["accession_number"],
    ])
  );

  // Initialize Portal repositories
  globalServiceRegistry.registerInstance(
    PORTAL_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(PortalSchema, PortalPrimaryKeyNames, [
      ["name"],
      ["brand"],
      ["live"],
    ])
  );

  // Initialize Crowdfunding repositories
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(CrowdfundingSchema, CrowdfundingPrimaryKeyNames, [
      ["portal_cik", "status", "state_jurisdiction"],
    ])
  );
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(
      CrowdfundingOfferingsSchema,
      CrowdfundingOfferingsPrimaryKeyNames,
      [["cik", "file_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_REPORTS_REPOSITORY_TOKEN,
    new InMemoryTabularRepository(CrowdfundingReportsSchema, CrowdfundingReportsPrimaryKeyNames, [])
  );
}
