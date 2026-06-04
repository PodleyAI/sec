/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage, globalServiceRegistry } from "workglow";
import {
  ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN,
  AddressesEntityHistoryJunctionSchema,
  AddressHistoryJunctionPrimaryKeyNames,
} from "../storage/address/AddressHistorySchema";
import {
  ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  ADDRESS_REPOSITORY_TOKEN,
  AddressJunctionPrimaryKeyNames,
  AddressPrimaryKeyNames,
  AddressSchema,
  AddressesEntityJunctionSchema,
} from "../storage/address/AddressSchema";
import {
  CHANGE_LOG_REPOSITORY_TOKEN,
  ChangeLogPrimaryKeyNames,
  ChangeLogSchema,
} from "../storage/change-tracking/ChangeLogSchema";
import {
  CIK_NAME_REPOSITORY_TOKEN,
  CikNamePrimaryKeyNames,
  CikNameSchema,
} from "../storage/entity/CikNameSchema";
import {
  ENTITY_HISTORY_REPOSITORY_TOKEN,
  EntityHistoryPrimaryKeyNames,
  EntityHistorySchema,
} from "../storage/entity/EntityHistorySchema";
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
  COMPANY_FACTS_REPOSITORY_TOKEN,
  CompanyFactsPrimaryKeyNames,
  CompanyFactsSchema,
} from "../storage/facts/CompanyFactsSchema";
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
  PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  PHONE_REPOSITORY_TOKEN,
  PhoneEntityJunctionPrimaryKeyNames,
  PhonePrimaryKeyNames,
  PhoneSchema,
  PhonesEntityJunctionSchema,
} from "../storage/phone/PhoneSchema";
import {
  CROWDFUNDING_HISTORY_REPOSITORY_TOKEN,
  CrowdfundingHistoryPrimaryKeyNames,
  CrowdfundingHistorySchema,
} from "../storage/portal/CrowdfundingHistorySchema";
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
import {
  SECTION16_FILING_REPOSITORY_TOKEN,
  SECTION16_HOLDING_REPOSITORY_TOKEN,
  SECTION16_TRANSACTION_REPOSITORY_TOKEN,
  Section16FilingPrimaryKeyNames,
  Section16FilingSchema,
  Section16HoldingPrimaryKeyNames,
  Section16HoldingSchema,
  Section16TransactionPrimaryKeyNames,
  Section16TransactionSchema,
} from "../storage/section16/Section16Schema";
import {
  FORM144_ACQUISITION_REPOSITORY_TOKEN,
  FORM144_FILING_REPOSITORY_TOKEN,
  FORM144_RECENT_SALE_REPOSITORY_TOKEN,
  Form144AcquisitionPrimaryKeyNames,
  Form144AcquisitionSchema,
  Form144FilingPrimaryKeyNames,
  Form144FilingSchema,
  Form144RecentSalePrimaryKeyNames,
  Form144RecentSaleSchema,
} from "../storage/form144/Form144Schema";
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
  REGA_EQUITY_CLASS_REPOSITORY_TOKEN,
  RegAEquityClassPrimaryKeyNames,
  RegAEquityClassSchema,
} from "../storage/reg-a/RegAEquityClassSchema";
import {
  REGA_FINANCIAL_DATA_REPOSITORY_TOKEN,
  RegAFinancialDataPrimaryKeyNames,
  RegAFinancialDataSchema,
} from "../storage/reg-a/RegAFinancialDataSchema";
import {
  REGA_OFFERING_HISTORY_REPOSITORY_TOKEN,
  RegAOfferingHistoryPrimaryKeyNames,
  RegAOfferingHistorySchema,
} from "../storage/reg-a/RegAOfferingHistorySchema";
import {
  REGA_OFFERING_REPOSITORY_TOKEN,
  RegAOfferingPrimaryKeyNames,
  RegAOfferingSchema,
} from "../storage/reg-a/RegAOfferingSchema";
import {
  REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN,
  RegAServiceProviderPrimaryKeyNames,
  RegAServiceProviderSchema,
} from "../storage/reg-a/RegAServiceProviderSchema";
import {
  CANONICAL_COMPANY_ALIAS_REPOSITORY_TOKEN,
  CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN,
  CanonicalCompanyAliasSchema,
  CanonicalCompanyAliasPrimaryKeyNames,
  CanonicalPersonAliasSchema,
  CanonicalPersonAliasPrimaryKeyNames,
} from "../storage/canonical/CanonicalAliasSchemas";
import {
  CANONICAL_COMPANY_REPOSITORY_TOKEN,
  CanonicalCompanyPrimaryKeyNames,
  CanonicalCompanySchema,
} from "../storage/canonical/CanonicalCompanySchema";
import {
  CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN,
  CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN,
  CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
  CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN,
  CanonicalCompanyAddressPrimaryKeyNames,
  CanonicalCompanyAddressSchema,
  CanonicalCompanyPhonePrimaryKeyNames,
  CanonicalCompanyPhoneSchema,
  CanonicalPersonAddressPrimaryKeyNames,
  CanonicalPersonAddressSchema,
  CanonicalPersonPhonePrimaryKeyNames,
  CanonicalPersonPhoneSchema,
} from "../storage/canonical/CanonicalJunctionSchemas";
import {
  CANONICAL_PERSON_REPOSITORY_TOKEN,
  CanonicalPersonPrimaryKeyNames,
  CanonicalPersonSchema,
} from "../storage/canonical/CanonicalPersonSchema";
import {
  COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN,
  CompanyIdentityLinkPrimaryKeyNames,
  CompanyIdentityLinkSchema,
} from "../storage/canonical/CompanyIdentityLinkSchema";
import {
  PERSON_IDENTITY_LINK_REPOSITORY_TOKEN,
  PersonIdentityLinkPrimaryKeyNames,
  PersonIdentityLinkSchema,
} from "../storage/canonical/PersonIdentityLinkSchema";
import {
  COMPANY_OBSERVATION_REPOSITORY_TOKEN,
  CompanyObservationPrimaryKeyNames,
  CompanyObservationSchema,
} from "../storage/observation/CompanyObservationSchema";
import {
  PERSON_OBSERVATION_REPOSITORY_TOKEN,
  PersonObservationPrimaryKeyNames,
  PersonObservationSchema,
} from "../storage/observation/PersonObservationSchema";
import {
  OBSERVATION_PROVENANCE_REPOSITORY_TOKEN,
  ObservationProvenancePrimaryKeyNames,
  ObservationProvenanceSchema,
} from "../storage/provenance/ObservationProvenanceSchema";
import {
  BENEFICIAL_OWNERSHIP_REPOSITORY_TOKEN,
  BeneficialOwnershipPrimaryKeyNames,
  BeneficialOwnershipSchema,
} from "../storage/beneficial-ownership/BeneficialOwnershipSchema";
import {
  RELATED_PARTY_TRANSACTION_REPOSITORY_TOKEN,
  RelatedPartyTransactionPrimaryKeyNames,
  RelatedPartyTransactionSchema,
} from "../storage/related-party/RelatedPartyTransactionSchema";
import {
  EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN,
  ExtractionDeadLetterPrimaryKeyNames,
  ExtractionDeadLetterSchema,
} from "../storage/dead-letter/ExtractionDeadLetterSchema";
import {
  COMPONENT_VERSION_REPOSITORY_TOKEN,
  ComponentVersionPrimaryKeyNames,
  ComponentVersionSchema,
} from "../storage/versioning/ComponentVersionSchema";
import {
  EXTRACTOR_RUN_REPOSITORY_TOKEN,
  ExtractorRunPrimaryKeyNames,
  ExtractorRunSchema,
} from "../storage/versioning/ExtractorRunSchema";
import {
  VERSION_EVENT_REPOSITORY_TOKEN,
  VersionEventPrimaryKeyNames,
  VersionEventSchema,
} from "../storage/versioning/VersionEventSchema";

export function resetDependencyInjectionsForTesting() {
  // Initialize Address repositories
  globalServiceRegistry.registerInstance(
    ADDRESS_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(AddressSchema, AddressPrimaryKeyNames, ["city"])
  );
  globalServiceRegistry.registerInstance(
    ADDRESS_JUNCTION_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(AddressesEntityJunctionSchema, AddressJunctionPrimaryKeyNames, [
      ["relation_name"],
      ["cik"],
    ])
  );
  globalServiceRegistry.registerInstance(
    ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(
      AddressesEntityHistoryJunctionSchema,
      AddressHistoryJunctionPrimaryKeyNames,
      [["cik"]]
    )
  );

  // Initialize Phone repositories
  globalServiceRegistry.registerInstance(
    PHONE_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(PhoneSchema, PhonePrimaryKeyNames, [])
  );
  globalServiceRegistry.registerInstance(
    PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(PhonesEntityJunctionSchema, PhoneEntityJunctionPrimaryKeyNames, [
      ["relation_name"],
      ["cik"],
    ])
  );

  // Initialize Investment Offering repositories
  globalServiceRegistry.registerInstance(
    INVESTMENT_OFFERING_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(InvestmentOfferingSchema, InvestmentOfferingPrimaryKeyNames, [
      ["cik"],
      ["industry_group"],
    ])
  );
  globalServiceRegistry.registerInstance(
    INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(
      InvestmentOfferingHistorySchema,
      InvestmentOfferingHistoryPrimaryKeyNames,
      [["cik"], ["file_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    ISSUER_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(IssuerSchema, IssuerPrimaryKeyNames, [["cik"], ["issuer_cik"]])
  );

  // Initialize Entity repositories
  globalServiceRegistry.registerInstance(
    ENTITY_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(EntitySchema, EntityPrimaryKeyNames, [["name"], ["sic"]])
  );
  globalServiceRegistry.registerInstance(
    ENTITY_HISTORY_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(EntityHistorySchema, EntityHistoryPrimaryKeyNames, [["valid_to"]])
  );
  globalServiceRegistry.registerInstance(
    ENTITY_TICKER_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(EntityTickerSchema, EntityTickerPrimaryKeyNames, [
      ["ticker", "exchange"],
      ["cik"],
    ])
  );
  globalServiceRegistry.registerInstance(
    SIC_CODE_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(SicCodeSchema, SicCodePrimaryKeyNames, [])
  );
  globalServiceRegistry.registerInstance(
    CIK_NAME_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CikNameSchema, CikNamePrimaryKeyNames, [["name"]])
  );

  // Initialize Filing repositories
  globalServiceRegistry.registerInstance(
    FILING_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(FilingSchema, FilingPrimaryKeyNames, [
      ["form", "cik"],
      ["filing_date"],
      ["accession_number"],
    ])
  );

  // Initialize Portal repositories
  globalServiceRegistry.registerInstance(
    PORTAL_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(PortalSchema, PortalPrimaryKeyNames, [["name"], ["brand"], ["live"]])
  );

  // Initialize Reg-A repositories
  globalServiceRegistry.registerInstance(
    REGA_OFFERING_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(RegAOfferingSchema, RegAOfferingPrimaryKeyNames, [
      ["status", "tier"],
    ])
  );
  globalServiceRegistry.registerInstance(
    REGA_OFFERING_HISTORY_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(RegAOfferingHistorySchema, RegAOfferingHistoryPrimaryKeyNames, [
      ["cik", "file_number"],
      ["file_number"],
    ])
  );
  globalServiceRegistry.registerInstance(
    REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(RegAServiceProviderSchema, RegAServiceProviderPrimaryKeyNames, [
      ["cik", "file_number"],
    ])
  );
  globalServiceRegistry.registerInstance(
    REGA_FINANCIAL_DATA_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(RegAFinancialDataSchema, RegAFinancialDataPrimaryKeyNames, [
      ["cik", "file_number"],
    ])
  );
  globalServiceRegistry.registerInstance(
    REGA_EQUITY_CLASS_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(RegAEquityClassSchema, RegAEquityClassPrimaryKeyNames, [
      ["cik", "file_number"],
    ])
  );

  // Initialize Crowdfunding repositories
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CrowdfundingSchema, CrowdfundingPrimaryKeyNames, [
      ["portal_cik", "status", "state_jurisdiction"],
    ])
  );
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CrowdfundingOfferingsSchema, CrowdfundingOfferingsPrimaryKeyNames, [
      ["cik", "file_number"],
    ])
  );
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_REPORTS_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CrowdfundingReportsSchema, CrowdfundingReportsPrimaryKeyNames, [])
  );
  globalServiceRegistry.registerInstance(
    CROWDFUNDING_HISTORY_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CrowdfundingHistorySchema, CrowdfundingHistoryPrimaryKeyNames, [
      ["cik", "file_number"],
    ])
  );

  // Initialize Section 16 (Forms 3/4/5) repositories
  globalServiceRegistry.registerInstance(
    SECTION16_FILING_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(Section16FilingSchema, Section16FilingPrimaryKeyNames, [
      ["issuer_cik"],
      ["form"],
    ])
  );
  globalServiceRegistry.registerInstance(
    SECTION16_TRANSACTION_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(
      Section16TransactionSchema,
      Section16TransactionPrimaryKeyNames,
      [["accession_number"], ["issuer_cik"]]
    )
  );
  globalServiceRegistry.registerInstance(
    SECTION16_HOLDING_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(Section16HoldingSchema, Section16HoldingPrimaryKeyNames, [
      ["accession_number"],
      ["issuer_cik"],
    ])
  );

  // Initialize Form 144 repositories
  globalServiceRegistry.registerInstance(
    FORM144_FILING_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(Form144FilingSchema, Form144FilingPrimaryKeyNames, [
      ["issuer_cik"],
      ["form"],
    ])
  );
  globalServiceRegistry.registerInstance(
    FORM144_ACQUISITION_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(Form144AcquisitionSchema, Form144AcquisitionPrimaryKeyNames, [
      ["accession_number"],
      ["issuer_cik"],
    ])
  );
  globalServiceRegistry.registerInstance(
    FORM144_RECENT_SALE_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(Form144RecentSaleSchema, Form144RecentSalePrimaryKeyNames, [
      ["accession_number"],
      ["issuer_cik"],
    ])
  );

  // Initialize Processing Tracking repositories
  globalServiceRegistry.registerInstance(
    CIK_LAST_UPDATE_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CikLastUpdateSchema, CikLastUpdatePrimaryKeyNames, [])
  );
  globalServiceRegistry.registerInstance(
    PROCESSED_FACTS_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(ProcessedFactsSchema, ProcessedFactsPrimaryKeyNames, [
      ["last_processed"],
    ])
  );
  globalServiceRegistry.registerInstance(
    PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(ProcessedSubmissionsSchema, ProcessedSubmissionsPrimaryKeyNames, [
      ["last_processed"],
    ])
  );

  // Initialize Versioning repositories
  globalServiceRegistry.registerInstance(
    COMPONENT_VERSION_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(ComponentVersionSchema, ComponentVersionPrimaryKeyNames, [])
  );
  globalServiceRegistry.registerInstance(
    EXTRACTOR_RUN_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(ExtractorRunSchema, ExtractorRunPrimaryKeyNames, [
      ["extractor_id", "extractor_version"],
      ["form", "extractor_version"],
    ])
  );
  globalServiceRegistry.registerInstance(
    VERSION_EVENT_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(VersionEventSchema, VersionEventPrimaryKeyNames, [
      ["component_kind", "component_id", "at_timestamp"],
    ])
  );

  // Initialize Company Facts repository
  globalServiceRegistry.registerInstance(
    COMPANY_FACTS_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CompanyFactsSchema, CompanyFactsPrimaryKeyNames, [["cik", "name"]])
  );

  // Initialize Change Log repository
  globalServiceRegistry.registerInstance(
    CHANGE_LOG_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(ChangeLogSchema, ChangeLogPrimaryKeyNames, [
      ["entity_type", "entity_id"],
    ])
  );

  // Initialize Observation / Canonical / Resolver repositories
  globalServiceRegistry.registerInstance(
    PERSON_OBSERVATION_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(PersonObservationSchema, PersonObservationPrimaryKeyNames, [
      ["accession_number"],
      ["accession_number", "extractor_id", "observation_index"],
    ])
  );
  globalServiceRegistry.registerInstance(
    COMPANY_OBSERVATION_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CompanyObservationSchema, CompanyObservationPrimaryKeyNames, [
      ["accession_number"],
      ["accession_number", "extractor_id", "observation_index"],
    ])
  );
  globalServiceRegistry.registerInstance(
    OBSERVATION_PROVENANCE_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(ObservationProvenanceSchema, ObservationProvenancePrimaryKeyNames)
  );
  globalServiceRegistry.registerInstance(
    BENEFICIAL_OWNERSHIP_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(BeneficialOwnershipSchema, BeneficialOwnershipPrimaryKeyNames, [
      ["accession_number"],
    ])
  );
  globalServiceRegistry.registerInstance(
    RELATED_PARTY_TRANSACTION_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(
      RelatedPartyTransactionSchema,
      RelatedPartyTransactionPrimaryKeyNames,
      [["accession_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(ExtractionDeadLetterSchema, ExtractionDeadLetterPrimaryKeyNames, [
      ["extractor_id"],
      ["status"],
    ])
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_PERSON_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CanonicalPersonSchema, CanonicalPersonPrimaryKeyNames, [
      ["resolver_version", "cik"],
      ["resolver_version", "normalized_last"],
    ])
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_COMPANY_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CanonicalCompanySchema, CanonicalCompanyPrimaryKeyNames, [
      ["resolver_version", "cik"],
      ["resolver_version", "crd_number"],
      ["resolver_version", "normalized_name"],
    ])
  );
  globalServiceRegistry.registerInstance(
    PERSON_IDENTITY_LINK_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(PersonIdentityLinkSchema, PersonIdentityLinkPrimaryKeyNames, [
      ["canonical_person_id", "resolver_version"],
      ["resolver_version"],
    ])
  );
  globalServiceRegistry.registerInstance(
    COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CompanyIdentityLinkSchema, CompanyIdentityLinkPrimaryKeyNames, [
      ["canonical_company_id", "resolver_version"],
      ["resolver_version"],
    ])
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CanonicalPersonAddressSchema, CanonicalPersonAddressPrimaryKeyNames, [
      ["canonical_person_id", "resolver_version"],
    ])
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CanonicalPersonPhoneSchema, CanonicalPersonPhonePrimaryKeyNames, [
      ["canonical_person_id", "resolver_version"],
    ])
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(
      CanonicalCompanyAddressSchema,
      CanonicalCompanyAddressPrimaryKeyNames,
      [["canonical_company_id", "resolver_version"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CanonicalCompanyPhoneSchema, CanonicalCompanyPhonePrimaryKeyNames, [
      ["canonical_company_id", "resolver_version"],
    ])
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CanonicalPersonAliasSchema, CanonicalPersonAliasPrimaryKeyNames, [])
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_COMPANY_ALIAS_REPOSITORY_TOKEN,
    new InMemoryTabularStorage(CanonicalCompanyAliasSchema, CanonicalCompanyAliasPrimaryKeyNames, [])
  );
}
