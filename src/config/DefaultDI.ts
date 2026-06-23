/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN,
  AddressesEntityHistoryJunctionSchema,
  AddressHistoryJunctionPrimaryKeyNames,
} from "../storage/address/AddressHistorySchema";
import {
  Address,
  ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  ADDRESS_REPOSITORY_TOKEN,
  AddressesEntityJunction,
  AddressesEntityJunctionSchema,
  AddressJunctionPrimaryKeyNames,
  AddressPrimaryKeyNames,
  AddressSchema,
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
  CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN,
  CANONICAL_UNDERWRITER_FAMILY_ALIAS_REPOSITORY_TOKEN,
  CanonicalCompanyAliasSchema,
  CanonicalCompanyAliasPrimaryKeyNames,
  CanonicalPersonAliasSchema,
  CanonicalPersonAliasPrimaryKeyNames,
  CanonicalSponsorFamilyAliasSchema,
  CanonicalSponsorFamilyAliasPrimaryKeyNames,
  CanonicalUnderwriterFamilyAliasSchema,
  CanonicalUnderwriterFamilyAliasPrimaryKeyNames,
} from "../storage/canonical/CanonicalAliasSchemas";
import {
  CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN,
  CanonicalSponsorFamilyPrimaryKeyNames,
  CanonicalSponsorFamilySchema,
} from "../storage/canonical/CanonicalSponsorFamilySchema";
import {
  SPONSOR_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN,
  SponsorFamilyMembershipPrimaryKeyNames,
  SponsorFamilyMembershipSchema,
} from "../storage/canonical/SponsorFamilyMembershipSchema";
import {
  SPAC_SPONSOR_LINK_REPOSITORY_TOKEN,
  SpacSponsorLinkPrimaryKeyNames,
  SpacSponsorLinkSchema,
} from "../storage/canonical/SpacSponsorLinkSchema";
import {
  OFFERING_TERMS_REPOSITORY_TOKEN,
  OfferingTermsPrimaryKeyNames,
  OfferingTermsSchema,
} from "../storage/offering/OfferingTermsSchema";
import {
  SPAC_UNIT_TERMS_REPOSITORY_TOKEN,
  SpacUnitTermsPrimaryKeyNames,
  SpacUnitTermsSchema,
} from "../storage/offering/SpacUnitTermsSchema";
import {
  ISSUER_TICKER_REPOSITORY_TOKEN,
  IssuerTickerPrimaryKeyNames,
  IssuerTickerSchema,
} from "../storage/offering/IssuerTickerSchema";
import {
  CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN,
  CanonicalUnderwriterFamilyPrimaryKeyNames,
  CanonicalUnderwriterFamilySchema,
} from "../storage/canonical/CanonicalUnderwriterFamilySchema";
import {
  UNDERWRITER_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN,
  UnderwriterFamilyMembershipPrimaryKeyNames,
  UnderwriterFamilyMembershipSchema,
} from "../storage/canonical/UnderwriterFamilyMembershipSchema";
import {
  UNDERWRITER_LINK_REPOSITORY_TOKEN,
  UnderwriterLinkPrimaryKeyNames,
  UnderwriterLinkSchema,
} from "../storage/canonical/UnderwriterLinkSchema";
import {
  USE_OF_PROCEEDS_REPOSITORY_TOKEN,
  UseOfProceedsPrimaryKeyNames,
  UseOfProceedsSchema,
} from "../storage/use-of-proceeds/UseOfProceedsSchema";
import {
  XBRL_FACT_REPOSITORY_TOKEN,
  XbrlFactPrimaryKeyNames,
  XbrlFactRowSchema,
} from "../storage/xbrl/XbrlFactSchema";
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
  S1_CLASSIFICATION_REPOSITORY_TOKEN,
  S1ClassificationPrimaryKeyNames,
  S1ClassificationSchema,
} from "../storage/classification/S1ClassificationSchema";
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
import {
  FORM_8K_EVENT_REPOSITORY_TOKEN,
  Form8KEventPrimaryKeyNames,
  Form8KEventSchema,
} from "../storage/form-8k-event/Form8KEventSchema";
import {
  SPAC_REPOSITORY_TOKEN,
  SpacPrimaryKeyNames,
  SpacSchema,
} from "../storage/spac/SpacSchema";
import {
  SPAC_DEAL_REPOSITORY_TOKEN,
  SpacDealPrimaryKeyNames,
  SpacDealSchema,
} from "../storage/spac/SpacDealSchema";
import {
  SPAC_EVENT_REPOSITORY_TOKEN,
  SpacEventPrimaryKeyNames,
  SpacEventSchema,
} from "../storage/spac/SpacEventSchema";
import {
  SPAC_HISTORY_REPOSITORY_TOKEN,
  SpacHistoryPrimaryKeyNames,
  SpacHistorySchema,
} from "../storage/spac/SpacHistorySchema";
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
    >("addresses_entity_junction", AddressesEntityJunctionSchema, AddressJunctionPrimaryKeyNames, [
      ["cik"],
    ])
  );
  globalServiceRegistry.registerInstance(
    ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN,
    createStorage(
      "addresses_entity_history_junction",
      AddressesEntityHistoryJunctionSchema,
      AddressHistoryJunctionPrimaryKeyNames,
      [["cik"]]
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
    ENTITY_HISTORY_REPOSITORY_TOKEN,
    createStorage("entities_history", EntityHistorySchema, EntityHistoryPrimaryKeyNames, [
      ["valid_to"],
    ])
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

  // ------------------------------ Section 16 (Forms 3/4/5) --------------------------------
  globalServiceRegistry.registerInstance(
    SECTION16_FILING_REPOSITORY_TOKEN,
    createStorage("section16_filings", Section16FilingSchema, Section16FilingPrimaryKeyNames, [
      ["issuer_cik"],
      ["form"],
    ])
  );
  globalServiceRegistry.registerInstance(
    SECTION16_TRANSACTION_REPOSITORY_TOKEN,
    createStorage(
      "section16_transactions",
      Section16TransactionSchema,
      Section16TransactionPrimaryKeyNames,
      [["accession_number"], ["issuer_cik"]]
    )
  );
  globalServiceRegistry.registerInstance(
    SECTION16_HOLDING_REPOSITORY_TOKEN,
    createStorage("section16_holdings", Section16HoldingSchema, Section16HoldingPrimaryKeyNames, [
      ["accession_number"],
      ["issuer_cik"],
    ])
  );

  // ------------------------------ Form 144 --------------------------------
  globalServiceRegistry.registerInstance(
    FORM144_FILING_REPOSITORY_TOKEN,
    createStorage("form144_filings", Form144FilingSchema, Form144FilingPrimaryKeyNames, [
      ["issuer_cik"],
      ["form"],
    ])
  );
  globalServiceRegistry.registerInstance(
    FORM144_ACQUISITION_REPOSITORY_TOKEN,
    createStorage(
      "form144_acquisitions",
      Form144AcquisitionSchema,
      Form144AcquisitionPrimaryKeyNames,
      [["accession_number"], ["issuer_cik"]]
    )
  );
  globalServiceRegistry.registerInstance(
    FORM144_RECENT_SALE_REPOSITORY_TOKEN,
    createStorage(
      "form144_recent_sales",
      Form144RecentSaleSchema,
      Form144RecentSalePrimaryKeyNames,
      [["accession_number"], ["issuer_cik"]]
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
    createStorage("portals", PortalSchema, PortalPrimaryKeyNames, [["name"], ["brand"], ["live"]])
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

  // ------------------------------ Versioning -----------------------------------
  globalServiceRegistry.registerInstance(
    COMPONENT_VERSION_REPOSITORY_TOKEN,
    createStorage("component_versions", ComponentVersionSchema, ComponentVersionPrimaryKeyNames)
  );
  globalServiceRegistry.registerInstance(
    EXTRACTOR_RUN_REPOSITORY_TOKEN,
    createStorage("extractor_runs", ExtractorRunSchema, ExtractorRunPrimaryKeyNames, [
      ["extractor_id", "extractor_version"],
      ["form", "extractor_version"],
    ])
  );
  globalServiceRegistry.registerInstance(
    VERSION_EVENT_REPOSITORY_TOKEN,
    createStorage("version_events", VersionEventSchema, VersionEventPrimaryKeyNames, [
      ["component_kind", "component_id", "at_timestamp"],
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

  // ------------------------------ SPAC ------------------------------------------
  globalServiceRegistry.registerInstance(
    SPAC_REPOSITORY_TOKEN,
    createStorage("spac", SpacSchema, SpacPrimaryKeyNames, [["status"], ["current_cik"]])
  );
  globalServiceRegistry.registerInstance(
    SPAC_DEAL_REPOSITORY_TOKEN,
    createStorage("spac_deal", SpacDealSchema, SpacDealPrimaryKeyNames, [["cik"], ["outcome"]])
  );
  globalServiceRegistry.registerInstance(
    SPAC_EVENT_REPOSITORY_TOKEN,
    createStorage("spac_event", SpacEventSchema, SpacEventPrimaryKeyNames, [
      ["cik"],
      ["event_type"],
    ])
  );
  globalServiceRegistry.registerInstance(
    SPAC_HISTORY_REPOSITORY_TOKEN,
    createStorage("spac_history", SpacHistorySchema, SpacHistoryPrimaryKeyNames, [["cik"]])
  );

  // ----- Observation / Canonical / Resolver -----
  globalServiceRegistry.registerInstance(
    PERSON_OBSERVATION_REPOSITORY_TOKEN,
    createStorage(
      "person_observations",
      PersonObservationSchema,
      PersonObservationPrimaryKeyNames,
      [["accession_number"], ["accession_number", "extractor_id", "observation_index"]]
    )
  );
  globalServiceRegistry.registerInstance(
    COMPANY_OBSERVATION_REPOSITORY_TOKEN,
    createStorage(
      "company_observations",
      CompanyObservationSchema,
      CompanyObservationPrimaryKeyNames,
      [["accession_number"], ["accession_number", "extractor_id", "observation_index"]]
    )
  );
  globalServiceRegistry.registerInstance(
    OBSERVATION_PROVENANCE_REPOSITORY_TOKEN,
    createStorage(
      "observation_provenance",
      ObservationProvenanceSchema,
      ObservationProvenancePrimaryKeyNames
    )
  );
  globalServiceRegistry.registerInstance(
    BENEFICIAL_OWNERSHIP_REPOSITORY_TOKEN,
    createStorage(
      "beneficial_ownership",
      BeneficialOwnershipSchema,
      BeneficialOwnershipPrimaryKeyNames,
      [["accession_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    RELATED_PARTY_TRANSACTION_REPOSITORY_TOKEN,
    createStorage(
      "related_party_transactions",
      RelatedPartyTransactionSchema,
      RelatedPartyTransactionPrimaryKeyNames,
      [["accession_number"]]
    )
  );
  globalServiceRegistry.registerInstance(
    EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN,
    createStorage(
      "extraction_dead_letter",
      ExtractionDeadLetterSchema,
      ExtractionDeadLetterPrimaryKeyNames,
      [["extractor_id"], ["status"]]
    )
  );
  globalServiceRegistry.registerInstance(
    S1_CLASSIFICATION_REPOSITORY_TOKEN,
    createStorage("s1_classification", S1ClassificationSchema, S1ClassificationPrimaryKeyNames)
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_PERSON_REPOSITORY_TOKEN,
    createStorage(
      "canonical_person",
      CanonicalPersonSchema,
      CanonicalPersonPrimaryKeyNames,
      [["resolver_version", "normalized_last"]],
      // Only CIK is a stable identity discriminator. Name tuples are NOT
      // unique: two distinct CIKs can legitimately share a normalized name
      // (e.g., parent/subsidiary, two registrations under the same legal
      // name). The resolver still uses name as a fallback lookup when no
      // CIK is present, but the storage layer cannot enforce uniqueness on
      // it without rejecting legitimate distinct entities.
      [["resolver_version", "cik"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_COMPANY_REPOSITORY_TOKEN,
    createStorage(
      "canonical_company",
      CanonicalCompanySchema,
      CanonicalCompanyPrimaryKeyNames,
      [],
      // CIK + CRD are stable identity discriminators. normalized_name is
      // NOT unique — see the CANONICAL_PERSON_REPOSITORY_TOKEN wiring for
      // the same rationale.
      [
        ["resolver_version", "cik"],
        ["resolver_version", "crd_number"],
      ]
    )
  );
  globalServiceRegistry.registerInstance(
    PERSON_IDENTITY_LINK_REPOSITORY_TOKEN,
    createStorage(
      "person_identity_link",
      PersonIdentityLinkSchema,
      PersonIdentityLinkPrimaryKeyNames,
      [["canonical_person_id", "resolver_version"], ["resolver_version"]]
    )
  );
  globalServiceRegistry.registerInstance(
    COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN,
    createStorage(
      "company_identity_link",
      CompanyIdentityLinkSchema,
      CompanyIdentityLinkPrimaryKeyNames,
      [["canonical_company_id", "resolver_version"], ["resolver_version"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
    createStorage(
      "canonical_person_address",
      CanonicalPersonAddressSchema,
      CanonicalPersonAddressPrimaryKeyNames,
      [["canonical_person_id", "resolver_version"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN,
    createStorage(
      "canonical_person_phone",
      CanonicalPersonPhoneSchema,
      CanonicalPersonPhonePrimaryKeyNames,
      [["canonical_person_id", "resolver_version"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN,
    createStorage(
      "canonical_company_address",
      CanonicalCompanyAddressSchema,
      CanonicalCompanyAddressPrimaryKeyNames,
      [["canonical_company_id", "resolver_version"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN,
    createStorage(
      "canonical_company_phone",
      CanonicalCompanyPhoneSchema,
      CanonicalCompanyPhonePrimaryKeyNames,
      [["canonical_company_id", "resolver_version"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN,
    createStorage(
      "canonical_person_alias",
      CanonicalPersonAliasSchema,
      CanonicalPersonAliasPrimaryKeyNames,
      []
    )
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_COMPANY_ALIAS_REPOSITORY_TOKEN,
    createStorage(
      "canonical_company_alias",
      CanonicalCompanyAliasSchema,
      CanonicalCompanyAliasPrimaryKeyNames,
      []
    )
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN,
    createStorage(
      "canonical_sponsor_family",
      CanonicalSponsorFamilySchema,
      CanonicalSponsorFamilyPrimaryKeyNames,
      [],
      // (resolver_version, normalized_name) is the family natural key — must be
      // enforced at the storage layer so two processes racing to mint the same
      // family converge on one row. Without this, the family-tier identity
      // tables silently forked under multi-process load.
      [["resolver_version", "normalized_name"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN,
    createStorage(
      "canonical_sponsor_family_alias",
      CanonicalSponsorFamilyAliasSchema,
      CanonicalSponsorFamilyAliasPrimaryKeyNames,
      [["target_canonical_id"]]
    )
  );
  globalServiceRegistry.registerInstance(
    SPONSOR_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN,
    createStorage(
      "sponsor_family_membership",
      SponsorFamilyMembershipSchema,
      SponsorFamilyMembershipPrimaryKeyNames,
      [["resolver_version", "canonical_sponsor_family_id"]]
    )
  );
  globalServiceRegistry.registerInstance(
    SPAC_SPONSOR_LINK_REPOSITORY_TOKEN,
    createStorage("spac_sponsor_link", SpacSponsorLinkSchema, SpacSponsorLinkPrimaryKeyNames, [
      ["accession_number"],
      ["sponsor_family_id"],
    ])
  );
  globalServiceRegistry.registerInstance(
    OFFERING_TERMS_REPOSITORY_TOKEN,
    createStorage("offering_terms", OfferingTermsSchema, OfferingTermsPrimaryKeyNames, [["cik"]])
  );
  globalServiceRegistry.registerInstance(
    SPAC_UNIT_TERMS_REPOSITORY_TOKEN,
    createStorage("spac_unit_terms", SpacUnitTermsSchema, SpacUnitTermsPrimaryKeyNames, [["cik"]])
  );
  globalServiceRegistry.registerInstance(
    ISSUER_TICKER_REPOSITORY_TOKEN,
    createStorage("issuer_ticker", IssuerTickerSchema, IssuerTickerPrimaryKeyNames, [
      ["cik"],
      ["accession_number"],
    ])
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN,
    createStorage(
      "canonical_underwriter_family",
      CanonicalUnderwriterFamilySchema,
      CanonicalUnderwriterFamilyPrimaryKeyNames,
      [],
      // (resolver_version, normalized_name) is the family natural key — must be
      // enforced at the storage layer so two processes racing to mint the same
      // family converge on one row. Without this, the family-tier identity
      // tables silently forked under multi-process load.
      [["resolver_version", "normalized_name"]]
    )
  );
  globalServiceRegistry.registerInstance(
    CANONICAL_UNDERWRITER_FAMILY_ALIAS_REPOSITORY_TOKEN,
    createStorage(
      "canonical_underwriter_family_alias",
      CanonicalUnderwriterFamilyAliasSchema,
      CanonicalUnderwriterFamilyAliasPrimaryKeyNames,
      [["target_canonical_id"]]
    )
  );
  globalServiceRegistry.registerInstance(
    UNDERWRITER_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN,
    createStorage(
      "underwriter_family_membership",
      UnderwriterFamilyMembershipSchema,
      UnderwriterFamilyMembershipPrimaryKeyNames,
      [["resolver_version", "canonical_underwriter_family_id"]]
    )
  );
  globalServiceRegistry.registerInstance(
    UNDERWRITER_LINK_REPOSITORY_TOKEN,
    createStorage("underwriter_link", UnderwriterLinkSchema, UnderwriterLinkPrimaryKeyNames, [
      ["accession_number"],
      ["underwriter_family_id"],
    ])
  );
  globalServiceRegistry.registerInstance(
    USE_OF_PROCEEDS_REPOSITORY_TOKEN,
    createStorage("use_of_proceeds", UseOfProceedsSchema, UseOfProceedsPrimaryKeyNames, [
      ["accession_number"],
    ])
  );
  globalServiceRegistry.registerInstance(
    XBRL_FACT_REPOSITORY_TOKEN,
    createStorage("xbrl_fact", XbrlFactRowSchema, XbrlFactPrimaryKeyNames, [["cik"], ["concept"]])
  );

  // ------------------------------ Form 8-K Events --------------------------------
  globalServiceRegistry.registerInstance(
    FORM_8K_EVENT_REPOSITORY_TOKEN,
    createStorage("form_8k_events", Form8KEventSchema, Form8KEventPrimaryKeyNames, [
      ["cik", "filing_date"],
      ["item_code"],
      ["accession_number"],
    ])
  );
};
