/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AnyTabularStorage,
  DataPortSchemaObject,
  FromSchema,
  ITabularStorage,
  ServiceToken,
  TypedArraySchemaOptions,
} from "workglow";
import {
  ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN,
  AddressesEntityHistoryJunctionSchema,
  AddressHistoryJunctionPrimaryKeyNames,
} from "../storage/address/AddressHistorySchema";
import {
  ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  ADDRESS_REPOSITORY_TOKEN,
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
  DAILY_INDEX_CURSOR_REPOSITORY_TOKEN,
  DailyIndexCursorPrimaryKeyNames,
  DailyIndexCursorSchema,
} from "../storage/processing/DailyIndexCursorSchema";
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
  REGA_CURRENT_REPORT_REPOSITORY_TOKEN,
  RegACurrentReportPrimaryKeyNames,
  RegACurrentReportSchema,
} from "../storage/reg-a/RegACurrentReportSchema";
import {
  REGA_OFFERING_EVENT_REPOSITORY_TOKEN,
  RegAOfferingEventPrimaryKeyNames,
  RegAOfferingEventSchema,
} from "../storage/reg-a/RegAOfferingEventSchema";
import {
  REGA_FINANCIAL_LINE_REPOSITORY_TOKEN,
  RegAFinancialLinePrimaryKeyNames,
  RegAFinancialLineSchema,
} from "../storage/reg-a/RegAFinancialLineSchema";
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
  FAMILY_DESCRIPTION_REPOSITORY_TOKEN,
  FamilyDescriptionPrimaryKeyNames,
  FamilyDescriptionSchema,
} from "../storage/canonical/FamilyDescriptionSchema";
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
  SPAC_PROMOTE_TERMS_REPOSITORY_TOKEN,
  SpacPromoteTermsPrimaryKeyNames,
  SpacPromoteTermsSchema,
} from "../storage/offering/SpacPromoteTermsSchema";
import {
  SPAC_LOCKUP_TERMS_REPOSITORY_TOKEN,
  SpacLockupTermsPrimaryKeyNames,
  SpacLockupTermsSchema,
} from "../storage/offering/SpacLockupTermsSchema";
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
  RISK_FACTOR_REPOSITORY_TOKEN,
  RiskFactorPrimaryKeyNames,
  RiskFactorSchema,
} from "../storage/risk-factor/RiskFactorSchema";
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
  PERSON_ROLE_REPOSITORY_TOKEN,
  PersonRolePrimaryKeyNames,
  PersonRoleSchema,
} from "../storage/canonical/PersonRoleSchema";
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
  PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN,
  PersonObservationTitlePrimaryKeyNames,
  PersonObservationTitleSchema,
  PersonObservationTitleTable,
} from "../storage/observation/PersonObservationTitleSchema";
import {
  FIELD_PROVENANCE_REPOSITORY_TOKEN,
  FieldProvenancePrimaryKeyNames,
  FieldProvenanceSchema,
} from "../storage/provenance/FieldProvenanceSchema";
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
  EXECUTIVE_COMPENSATION_REPOSITORY_TOKEN,
  ExecutiveCompensationPrimaryKeyNames,
  ExecutiveCompensationSchema,
} from "../storage/executive-compensation/ExecutiveCompensationSchema";
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
  Form8KEventUniqueIndexes,
} from "../storage/form-8k-event/Form8KEventSchema";
import { SPAC_REPOSITORY_TOKEN, SpacPrimaryKeyNames, SpacSchema } from "../storage/spac/SpacSchema";
import {
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  SpacCandidatePrimaryKeyNames,
  SpacCandidateSchema,
} from "../storage/spac/SpacCandidateSchema";
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
import {
  SPAC_MERGER_EXTRACTION_REPOSITORY_TOKEN,
  SpacMergerExtractionPrimaryKeyNames,
  SpacMergerExtractionSchema,
} from "../storage/spac/SpacMergerExtractionSchema";
import {
  SPAC_REDEMPTION_EXTRACTION_REPOSITORY_TOKEN,
  SpacRedemptionExtractionPrimaryKeyNames,
  SpacRedemptionExtractionSchema,
} from "../storage/spac/SpacRedemptionExtractionSchema";
import {
  SPAC_LOI_EXTRACTION_REPOSITORY_TOKEN,
  SpacLoiExtractionPrimaryKeyNames,
  SpacLoiExtractionSchema,
} from "../storage/spac/SpacLoiExtractionSchema";

/**
 * One tabular storage: the DI token it is registered under, the table it maps
 * to, and the shape both bootstraps build it from. Erased to a single element
 * type so the registry can be one array; {@link defineStorage} is what type-
 * checks each entry against its own schema.
 */
export interface StorageDefinition {
  readonly token: ServiceToken<AnyTabularStorage>;
  readonly table: string;
  readonly schema: DataPortSchemaObject;
  readonly primaryKeyNames: ReadonlyArray<string>;
  readonly indexes: readonly (string | readonly string[])[] | undefined;
  readonly uniqueIndexes: readonly (readonly string[])[] | undefined;
}

interface TypedStorageDefinition<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity,
> {
  readonly token: ServiceToken<ITabularStorage<Schema, PrimaryKeyNames, Entity>>;
  readonly table: string;
  readonly schema: Schema;
  readonly primaryKeyNames: PrimaryKeyNames;
  readonly indexes?: readonly (keyof Entity | readonly (keyof Entity)[])[];
  readonly uniqueIndexes?: readonly (readonly (keyof Entity)[])[];
}

/**
 * Type-checks one registry entry — index and unique-index columns against the
 * entity the schema produces, and the token against the storage type that
 * schema + primary key yield — then erases it into {@link StorageDefinition}.
 * The erasure is what lets 80-odd differently-typed tables live in one array.
 */
export function defineStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>(definition: TypedStorageDefinition<Schema, PrimaryKeyNames, Entity>): StorageDefinition {
  return definition as unknown as StorageDefinition;
}

/**
 * Every tabular storage sec owns, in the order the tables are created and
 * dropped. Both bootstraps read exactly this list: `DefaultDI` builds each
 * entry through `createStorage` (SQLite / Postgres, per `SEC_DB_TYPE`) and
 * `resetDependencyInjectionsForTesting` builds each as an
 * `InMemoryTabularStorage`, so a table can no longer exist in one and not the
 * other.
 *
 * Indexes are declared once, from the production DDL. The in-memory backend
 * stores them but serves `query`/`getAll` by full scan, so they only shape the
 * SQL backends' DDL.
 */
export const SEC_STORAGE_REGISTRY: readonly StorageDefinition[] = [
  // ------------------------------ Addresses --------------------------------
  defineStorage({
    token: ADDRESS_REPOSITORY_TOKEN,
    table: "addresses",
    schema: AddressSchema,
    primaryKeyNames: AddressPrimaryKeyNames,
    indexes: ["city"],
  }),
  defineStorage({
    token: ADDRESS_JUNCTION_REPOSITORY_TOKEN,
    table: "addresses_entity_junction",
    schema: AddressesEntityJunctionSchema,
    primaryKeyNames: AddressJunctionPrimaryKeyNames,
    indexes: [["cik"]],
  }),
  defineStorage({
    token: ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN,
    table: "addresses_entity_history_junction",
    schema: AddressesEntityHistoryJunctionSchema,
    primaryKeyNames: AddressHistoryJunctionPrimaryKeyNames,
    indexes: [["cik"]],
  }),
  // ------------------------------ Phones --------------------------------
  defineStorage({
    token: PHONE_REPOSITORY_TOKEN,
    table: "phones",
    schema: PhoneSchema,
    primaryKeyNames: PhonePrimaryKeyNames,
  }),
  defineStorage({
    token: PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN,
    table: "phones_entity_junction",
    schema: PhonesEntityJunctionSchema,
    primaryKeyNames: PhoneEntityJunctionPrimaryKeyNames,
    indexes: [["cik"]],
  }),
  // ------------------------------ Investment Offerings --------------------------------
  defineStorage({
    token: INVESTMENT_OFFERING_REPOSITORY_TOKEN,
    table: "investment_offerings",
    schema: InvestmentOfferingSchema,
    primaryKeyNames: InvestmentOfferingPrimaryKeyNames,
    indexes: [["industry_group", "industry_subgroup"]],
  }),
  defineStorage({
    token: INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN,
    table: "investment_offerings_history",
    schema: InvestmentOfferingHistorySchema,
    primaryKeyNames: InvestmentOfferingHistoryPrimaryKeyNames,
    indexes: [["accession_number"]],
  }),
  // ------------------------------ Issuers --------------------------------
  defineStorage({
    token: ISSUER_REPOSITORY_TOKEN,
    table: "issuers",
    schema: IssuerSchema,
    primaryKeyNames: IssuerPrimaryKeyNames,
    indexes: [["issuer_cik", "cik"]],
  }),
  // ------------------------------ Entities --------------------------------
  defineStorage({
    token: ENTITY_REPOSITORY_TOKEN,
    table: "entities",
    schema: EntitySchema,
    primaryKeyNames: EntityPrimaryKeyNames,
    indexes: [["name"], ["sic"]],
  }),
  defineStorage({
    token: ENTITY_HISTORY_REPOSITORY_TOKEN,
    table: "entities_history",
    schema: EntityHistorySchema,
    primaryKeyNames: EntityHistoryPrimaryKeyNames,
    indexes: [["valid_to"]],
  }),
  defineStorage({
    token: ENTITY_TICKER_REPOSITORY_TOKEN,
    table: "entity_tickers",
    schema: EntityTickerSchema,
    primaryKeyNames: EntityTickerPrimaryKeyNames,
    indexes: [["ticker", "exchange"], ["cik"]],
  }),
  defineStorage({
    token: SIC_CODE_REPOSITORY_TOKEN,
    table: "sic_code",
    schema: SicCodeSchema,
    primaryKeyNames: SicCodePrimaryKeyNames,
  }),
  defineStorage({
    token: CIK_NAME_REPOSITORY_TOKEN,
    table: "cik_names",
    schema: CikNameSchema,
    primaryKeyNames: CikNamePrimaryKeyNames,
    indexes: [["name"]],
  }),
  // ------------------------------ Filings --------------------------------
  defineStorage({
    token: FILING_REPOSITORY_TOKEN,
    table: "filings",
    schema: FilingSchema,
    primaryKeyNames: FilingPrimaryKeyNames,
    indexes: [["form", "cik"], ["filing_date"], ["accession_number"]],
  }),
  // ------------------------------ Crowdfunding --------------------------------
  defineStorage({
    token: CROWDFUNDING_REPOSITORY_TOKEN,
    table: "crowdfunding",
    schema: CrowdfundingSchema,
    primaryKeyNames: CrowdfundingPrimaryKeyNames,
    indexes: [["portal_cik", "status", "state_jurisdiction"]],
  }),
  defineStorage({
    token: CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN,
    table: "crowdfunding_offerings",
    schema: CrowdfundingOfferingsSchema,
    primaryKeyNames: CrowdfundingOfferingsPrimaryKeyNames,
    indexes: [["cik", "file_number"]],
  }),
  defineStorage({
    token: CROWDFUNDING_REPORTS_REPOSITORY_TOKEN,
    table: "crowdfunding_reports",
    schema: CrowdfundingReportsSchema,
    primaryKeyNames: CrowdfundingReportsPrimaryKeyNames,
  }),
  // ------------------------------ Crowdfunding History --------------------------------
  defineStorage({
    token: CROWDFUNDING_HISTORY_REPOSITORY_TOKEN,
    table: "crowdfunding_history",
    schema: CrowdfundingHistorySchema,
    primaryKeyNames: CrowdfundingHistoryPrimaryKeyNames,
    indexes: [["cik", "file_number"]],
  }),
  // ------------------------------ Section 16 (Forms 3/4/5) --------------------------------
  defineStorage({
    token: SECTION16_FILING_REPOSITORY_TOKEN,
    table: "section16_filings",
    schema: Section16FilingSchema,
    primaryKeyNames: Section16FilingPrimaryKeyNames,
    indexes: [["issuer_cik"], ["form"]],
  }),
  defineStorage({
    token: SECTION16_TRANSACTION_REPOSITORY_TOKEN,
    table: "section16_transactions",
    schema: Section16TransactionSchema,
    primaryKeyNames: Section16TransactionPrimaryKeyNames,
    indexes: [["accession_number"], ["issuer_cik"]],
  }),
  defineStorage({
    token: SECTION16_HOLDING_REPOSITORY_TOKEN,
    table: "section16_holdings",
    schema: Section16HoldingSchema,
    primaryKeyNames: Section16HoldingPrimaryKeyNames,
    indexes: [["accession_number"], ["issuer_cik"]],
  }),
  // ------------------------------ Form 144 --------------------------------
  defineStorage({
    token: FORM144_FILING_REPOSITORY_TOKEN,
    table: "form144_filings",
    schema: Form144FilingSchema,
    primaryKeyNames: Form144FilingPrimaryKeyNames,
    indexes: [["issuer_cik"], ["form"]],
  }),
  defineStorage({
    token: FORM144_ACQUISITION_REPOSITORY_TOKEN,
    table: "form144_acquisitions",
    schema: Form144AcquisitionSchema,
    primaryKeyNames: Form144AcquisitionPrimaryKeyNames,
    indexes: [["accession_number"], ["issuer_cik"]],
  }),
  defineStorage({
    token: FORM144_RECENT_SALE_REPOSITORY_TOKEN,
    table: "form144_recent_sales",
    schema: Form144RecentSaleSchema,
    primaryKeyNames: Form144RecentSalePrimaryKeyNames,
    indexes: [["accession_number"], ["issuer_cik"]],
  }),
  // ------------------------------ Change Log --------------------------------
  defineStorage({
    token: CHANGE_LOG_REPOSITORY_TOKEN,
    table: "change_log",
    schema: ChangeLogSchema,
    primaryKeyNames: ChangeLogPrimaryKeyNames,
    indexes: [["entity_type", "entity_id"]],
  }),
  // ------------------------------ Portals --------------------------------
  defineStorage({
    token: PORTAL_REPOSITORY_TOKEN,
    table: "portals",
    schema: PortalSchema,
    primaryKeyNames: PortalPrimaryKeyNames,
    indexes: [["name"], ["brand"], ["live"]],
  }),
  // ------------------------------ Processing Tracking --------------------------------
  defineStorage({
    token: CIK_LAST_UPDATE_REPOSITORY_TOKEN,
    table: "cik_last_update",
    schema: CikLastUpdateSchema,
    primaryKeyNames: CikLastUpdatePrimaryKeyNames,
  }),
  defineStorage({
    token: DAILY_INDEX_CURSOR_REPOSITORY_TOKEN,
    table: "daily_index_cursor",
    schema: DailyIndexCursorSchema,
    primaryKeyNames: DailyIndexCursorPrimaryKeyNames,
  }),
  defineStorage({
    token: PROCESSED_FACTS_REPOSITORY_TOKEN,
    table: "processed_facts",
    schema: ProcessedFactsSchema,
    primaryKeyNames: ProcessedFactsPrimaryKeyNames,
    indexes: [["last_processed"]],
  }),
  defineStorage({
    token: PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN,
    table: "processed_submissions",
    schema: ProcessedSubmissionsSchema,
    primaryKeyNames: ProcessedSubmissionsPrimaryKeyNames,
    indexes: [["last_processed"]],
  }),
  // ------------------------------ Versioning -----------------------------------
  defineStorage({
    token: COMPONENT_VERSION_REPOSITORY_TOKEN,
    table: "component_versions",
    schema: ComponentVersionSchema,
    primaryKeyNames: ComponentVersionPrimaryKeyNames,
  }),
  defineStorage({
    token: EXTRACTOR_RUN_REPOSITORY_TOKEN,
    table: "extractor_runs",
    schema: ExtractorRunSchema,
    primaryKeyNames: ExtractorRunPrimaryKeyNames,
    indexes: [
      ["extractor_id", "extractor_version"],
      ["form", "extractor_version"],
    ],
  }),
  defineStorage({
    token: VERSION_EVENT_REPOSITORY_TOKEN,
    table: "version_events",
    schema: VersionEventSchema,
    primaryKeyNames: VersionEventPrimaryKeyNames,
    indexes: [["component_kind", "component_id", "at_timestamp"]],
  }),
  // ------------------------------ Company Facts --------------------------------
  defineStorage({
    token: COMPANY_FACTS_REPOSITORY_TOKEN,
    table: "company_facts",
    schema: CompanyFactsSchema,
    primaryKeyNames: CompanyFactsPrimaryKeyNames,
    indexes: [["cik", "name"]],
  }),
  // ------------------------------ Reg-A Offerings --------------------------------
  defineStorage({
    token: REGA_OFFERING_REPOSITORY_TOKEN,
    table: "rega_offerings",
    schema: RegAOfferingSchema,
    primaryKeyNames: RegAOfferingPrimaryKeyNames,
    indexes: [["status", "tier"]],
  }),
  defineStorage({
    token: REGA_OFFERING_HISTORY_REPOSITORY_TOKEN,
    table: "rega_offering_history",
    schema: RegAOfferingHistorySchema,
    primaryKeyNames: RegAOfferingHistoryPrimaryKeyNames,
    indexes: [["cik", "file_number"], ["file_number"]],
  }),
  defineStorage({
    token: REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN,
    table: "rega_service_providers",
    schema: RegAServiceProviderSchema,
    primaryKeyNames: RegAServiceProviderPrimaryKeyNames,
    indexes: [["cik", "file_number"]],
  }),
  defineStorage({
    token: REGA_FINANCIAL_DATA_REPOSITORY_TOKEN,
    table: "rega_financial_data",
    schema: RegAFinancialDataSchema,
    primaryKeyNames: RegAFinancialDataPrimaryKeyNames,
    indexes: [["cik", "file_number"]],
  }),
  defineStorage({
    token: REGA_EQUITY_CLASS_REPOSITORY_TOKEN,
    table: "rega_equity_classes",
    schema: RegAEquityClassSchema,
    primaryKeyNames: RegAEquityClassPrimaryKeyNames,
    indexes: [["cik", "file_number"]],
  }),
  defineStorage({
    token: REGA_CURRENT_REPORT_REPOSITORY_TOKEN,
    table: "rega_current_report",
    schema: RegACurrentReportSchema,
    primaryKeyNames: RegACurrentReportPrimaryKeyNames,
    // Indexed by issuer (the timeline query) and by the classification, so the
    // ~1,000 substantive reports are findable without scanning 11,600 rows of
    // "other".
    indexes: [["cik", "filing_date"], ["event_type"]],
  }),
  defineStorage({
    token: REGA_FINANCIAL_LINE_REPOSITORY_TOKEN,
    table: "rega_financial_line",
    schema: RegAFinancialLineSchema,
    primaryKeyNames: RegAFinancialLinePrimaryKeyNames,
    // Indexed by issuer over time (an issuer's statements across filings) and by
    // the line item itself, which is how a series is pulled: "total assets for
    // this CIK, every period". Without the second index that query scans the
    // whole table, since the primary key leads with the accession.
    indexes: [
      ["cik", "filing_date"],
      ["cik", "label"],
    ],
  }),
  defineStorage({
    token: REGA_OFFERING_EVENT_REPOSITORY_TOKEN,
    table: "rega_offering_event",
    schema: RegAOfferingEventSchema,
    primaryKeyNames: RegAOfferingEventPrimaryKeyNames,
    // By issuer over time (the timeline query) and by the offering the event
    // belongs to, which is how a supplement is joined back to its `024-` line.
    indexes: [["cik", "filing_date"], ["file_number"]],
  }),
  // ------------------------------ SPAC ------------------------------------------
  defineStorage({
    token: SPAC_REPOSITORY_TOKEN,
    table: "spac",
    schema: SpacSchema,
    primaryKeyNames: SpacPrimaryKeyNames,
    indexes: [["status"], ["current_cik"]],
  }),
  defineStorage({
    token: SPAC_CANDIDATE_REPOSITORY_TOKEN,
    table: "spac_candidate",
    schema: SpacCandidateSchema,
    primaryKeyNames: SpacCandidatePrimaryKeyNames,
    indexes: [["confidence"], ["first_reg_date"]],
  }),
  defineStorage({
    token: SPAC_DEAL_REPOSITORY_TOKEN,
    table: "spac_deal",
    schema: SpacDealSchema,
    primaryKeyNames: SpacDealPrimaryKeyNames,
    indexes: [["cik"], ["outcome"]],
  }),
  defineStorage({
    token: SPAC_EVENT_REPOSITORY_TOKEN,
    table: "spac_event",
    schema: SpacEventSchema,
    primaryKeyNames: SpacEventPrimaryKeyNames,
    indexes: [["cik"], ["event_type"]],
  }),
  defineStorage({
    token: SPAC_HISTORY_REPOSITORY_TOKEN,
    table: "spac_history",
    schema: SpacHistorySchema,
    primaryKeyNames: SpacHistoryPrimaryKeyNames,
    indexes: [["cik"]],
  }),
  defineStorage({
    token: SPAC_MERGER_EXTRACTION_REPOSITORY_TOKEN,
    table: "spac_merger_extraction",
    schema: SpacMergerExtractionSchema,
    primaryKeyNames: SpacMergerExtractionPrimaryKeyNames,
    indexes: [["cik"]],
  }),
  defineStorage({
    token: SPAC_REDEMPTION_EXTRACTION_REPOSITORY_TOKEN,
    table: "spac_redemption_extraction",
    schema: SpacRedemptionExtractionSchema,
    primaryKeyNames: SpacRedemptionExtractionPrimaryKeyNames,
    indexes: [["cik"]],
  }),
  defineStorage({
    token: SPAC_LOI_EXTRACTION_REPOSITORY_TOKEN,
    table: "spac_loi_extraction",
    schema: SpacLoiExtractionSchema,
    primaryKeyNames: SpacLoiExtractionPrimaryKeyNames,
    indexes: [["cik"]],
  }),
  // ----- Observation / Canonical / Resolver -----
  defineStorage({
    token: PERSON_OBSERVATION_REPOSITORY_TOKEN,
    table: "person_observations",
    schema: PersonObservationSchema,
    primaryKeyNames: PersonObservationPrimaryKeyNames,
    // The issuer index serves "everyone this filer disclosed", the roster
    // read every downstream consumer issues. Without it that is a sequential
    // scan of the largest table in the database (one row per person mention
    // in every filing), so extractor_id trails the issuer to keep a
    // single-extractor roster (e.g. S-1 management) index-only.
    indexes: [["accession_number"], ["source_filing_issuer_cik", "extractor_id"]],
    // The natural key is UNIQUE (one row per mention). Enforcing it at the
    // storage layer closes the find-or-insert race in upsertByNaturalKey
    // (two concurrent inserts both saw no row) the same way the resolver
    // relies on (resolver_version, cik) — the repo recovers by re-querying.
    uniqueIndexes: [["accession_number", "extractor_id", "observation_index"]],
  }),
  defineStorage({
    token: PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN,
    table: PersonObservationTitleTable,
    schema: PersonObservationTitleSchema,
    primaryKeyNames: PersonObservationTitlePrimaryKeyNames,
    indexes: [["observation_id"]],
  }),
  defineStorage({
    token: COMPANY_OBSERVATION_REPOSITORY_TOKEN,
    table: "company_observations",
    schema: CompanyObservationSchema,
    primaryKeyNames: CompanyObservationPrimaryKeyNames,
    // `cik` is the OBSERVED company's own number, and "what has this company
    // been called" is the read every name-fallback issues — a company whose
    // canonical name is missing is looked up by CIK, one company at a time.
    // Unmatched by an index that is a sequential scan of one row per company
    // mention in every filing, so a single-company lookup costs the whole
    // table; `accession_number` indexes the other direction (the companies one
    // filing named) and cannot serve it.
    indexes: [["accession_number"], ["cik"]],
    // The natural key is UNIQUE — see person_observations above.
    uniqueIndexes: [["accession_number", "extractor_id", "observation_index"]],
  }),
  defineStorage({
    token: OBSERVATION_PROVENANCE_REPOSITORY_TOKEN,
    table: "observation_provenance",
    schema: ObservationProvenanceSchema,
    primaryKeyNames: ObservationProvenancePrimaryKeyNames,
  }),
  defineStorage({
    token: FIELD_PROVENANCE_REPOSITORY_TOKEN,
    table: "field_provenance",
    schema: FieldProvenanceSchema,
    primaryKeyNames: FieldProvenancePrimaryKeyNames,
    indexes: [["accession_number"]],
  }),
  defineStorage({
    token: BENEFICIAL_OWNERSHIP_REPOSITORY_TOKEN,
    table: "beneficial_ownership",
    schema: BeneficialOwnershipSchema,
    primaryKeyNames: BeneficialOwnershipPrimaryKeyNames,
    indexes: [["accession_number"]],
  }),
  defineStorage({
    token: EXECUTIVE_COMPENSATION_REPOSITORY_TOKEN,
    table: "executive_compensation",
    schema: ExecutiveCompensationSchema,
    primaryKeyNames: ExecutiveCompensationPrimaryKeyNames,
    indexes: [["accession_number"]],
  }),
  defineStorage({
    token: RELATED_PARTY_TRANSACTION_REPOSITORY_TOKEN,
    table: "related_party_transactions",
    schema: RelatedPartyTransactionSchema,
    primaryKeyNames: RelatedPartyTransactionPrimaryKeyNames,
    indexes: [["accession_number"]],
  }),
  defineStorage({
    token: EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN,
    table: "extraction_dead_letter",
    schema: ExtractionDeadLetterSchema,
    primaryKeyNames: ExtractionDeadLetterPrimaryKeyNames,
    indexes: [["extractor_id"], ["status"]],
  }),
  defineStorage({
    token: S1_CLASSIFICATION_REPOSITORY_TOKEN,
    table: "s1_classification",
    schema: S1ClassificationSchema,
    primaryKeyNames: S1ClassificationPrimaryKeyNames,
    // The SPAC candidate scan groups this table by `cik` and reads `sic`,
    // `is_spac`, `created_at` and `accession_number`. The PK is
    // `(extractor_id, accession_number)`, so nothing else covers that set —
    // and `setupDatabase()` re-emits `CREATE INDEX IF NOT EXISTS` on every run,
    // so an existing database picks this up without a migration. The previous
    // `(cik, sic)` index is left standing on databases that already have it;
    // it is a prefix of this one and is unused by the scan once this exists.
    indexes: [["cik", "sic", "is_spac", "created_at", "accession_number"]],
  }),
  defineStorage({
    token: CANONICAL_PERSON_REPOSITORY_TOKEN,
    table: "canonical_person",
    schema: CanonicalPersonSchema,
    primaryKeyNames: CanonicalPersonPrimaryKeyNames,
    indexes: [["resolver_version", "normalized_last"]],
    // Only CIK is a stable identity discriminator. Name tuples are NOT
    // unique: two distinct CIKs can legitimately share a normalized name
    // (e.g., parent/subsidiary, two registrations under the same legal
    // name). The resolver still uses name as a fallback lookup when no
    // CIK is present, but the storage layer cannot enforce uniqueness on
    // it without rejecting legitimate distinct entities.
    uniqueIndexes: [["resolver_version", "cik"]],
  }),
  defineStorage({
    token: CANONICAL_COMPANY_REPOSITORY_TOKEN,
    table: "canonical_company",
    schema: CanonicalCompanySchema,
    primaryKeyNames: CanonicalCompanyPrimaryKeyNames,
    indexes: [],
    // CIK + CRD are stable identity discriminators. normalized_name is
    // NOT unique — see the CANONICAL_PERSON_REPOSITORY_TOKEN wiring for
    // the same rationale.
    uniqueIndexes: [
      ["resolver_version", "cik"],
      ["resolver_version", "crd_number"],
    ],
  }),
  defineStorage({
    token: PERSON_IDENTITY_LINK_REPOSITORY_TOKEN,
    table: "person_identity_link",
    schema: PersonIdentityLinkSchema,
    primaryKeyNames: PersonIdentityLinkPrimaryKeyNames,
    indexes: [["canonical_person_id", "resolver_version"], ["resolver_version"]],
  }),
  defineStorage({
    token: COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN,
    table: "company_identity_link",
    schema: CompanyIdentityLinkSchema,
    primaryKeyNames: CompanyIdentityLinkPrimaryKeyNames,
    indexes: [["canonical_company_id", "resolver_version"], ["resolver_version"]],
  }),
  defineStorage({
    token: PERSON_ROLE_REPOSITORY_TOKEN,
    table: "person_role",
    schema: PersonRoleSchema,
    primaryKeyNames: PersonRolePrimaryKeyNames,
    indexes: [
      ["canonical_person_id", "resolver_version"],
      ["company_cik", "extractor_id", "role_scope", "resolver_version"],
      ["resolver_version"],
    ],
  }),
  defineStorage({
    token: CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
    table: "canonical_person_address",
    schema: CanonicalPersonAddressSchema,
    primaryKeyNames: CanonicalPersonAddressPrimaryKeyNames,
    indexes: [["canonical_person_id", "resolver_version"]],
  }),
  defineStorage({
    token: CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN,
    table: "canonical_person_phone",
    schema: CanonicalPersonPhoneSchema,
    primaryKeyNames: CanonicalPersonPhonePrimaryKeyNames,
    indexes: [["canonical_person_id", "resolver_version"]],
  }),
  defineStorage({
    token: CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN,
    table: "canonical_company_address",
    schema: CanonicalCompanyAddressSchema,
    primaryKeyNames: CanonicalCompanyAddressPrimaryKeyNames,
    indexes: [["canonical_company_id", "resolver_version"]],
  }),
  defineStorage({
    token: CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN,
    table: "canonical_company_phone",
    schema: CanonicalCompanyPhoneSchema,
    primaryKeyNames: CanonicalCompanyPhonePrimaryKeyNames,
    indexes: [["canonical_company_id", "resolver_version"]],
  }),
  defineStorage({
    token: CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN,
    table: "canonical_person_alias",
    schema: CanonicalPersonAliasSchema,
    primaryKeyNames: CanonicalPersonAliasPrimaryKeyNames,
    indexes: [],
  }),
  defineStorage({
    token: CANONICAL_COMPANY_ALIAS_REPOSITORY_TOKEN,
    table: "canonical_company_alias",
    schema: CanonicalCompanyAliasSchema,
    primaryKeyNames: CanonicalCompanyAliasPrimaryKeyNames,
    indexes: [],
  }),
  defineStorage({
    token: CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN,
    table: "canonical_sponsor_family",
    schema: CanonicalSponsorFamilySchema,
    primaryKeyNames: CanonicalSponsorFamilyPrimaryKeyNames,
    indexes: [],
    // (resolver_version, normalized_name) is the family natural key — must be
    // enforced at the storage layer so two processes racing to mint the same
    // family converge on one row. Without this, the family-tier identity
    // tables silently forked under multi-process load.
    uniqueIndexes: [["resolver_version", "normalized_name"]],
  }),
  defineStorage({
    token: CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN,
    table: "canonical_sponsor_family_alias",
    schema: CanonicalSponsorFamilyAliasSchema,
    primaryKeyNames: CanonicalSponsorFamilyAliasPrimaryKeyNames,
    indexes: [["target_canonical_id"]],
  }),
  defineStorage({
    token: FAMILY_DESCRIPTION_REPOSITORY_TOKEN,
    table: "family_description",
    schema: FamilyDescriptionSchema,
    primaryKeyNames: FamilyDescriptionPrimaryKeyNames,
    indexes: [["family_kind"]],
  }),
  defineStorage({
    token: SPONSOR_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN,
    table: "sponsor_family_membership",
    schema: SponsorFamilyMembershipSchema,
    primaryKeyNames: SponsorFamilyMembershipPrimaryKeyNames,
    indexes: [["resolver_version", "canonical_sponsor_family_id"]],
  }),
  defineStorage({
    token: SPAC_SPONSOR_LINK_REPOSITORY_TOKEN,
    table: "spac_sponsor_link",
    schema: SpacSponsorLinkSchema,
    primaryKeyNames: SpacSponsorLinkPrimaryKeyNames,
    // "Which families sponsor this issuer", always qualified by the active
    // resolver version. The issuer leads because it is the selective term —
    // a resolver_version-first index degenerates to a scan, since nearly
    // every row carries the current version.
    indexes: [["accession_number"], ["sponsor_family_id"], ["issuer_cik", "resolver_version"]],
  }),
  defineStorage({
    token: OFFERING_TERMS_REPOSITORY_TOKEN,
    table: "offering_terms",
    schema: OfferingTermsSchema,
    primaryKeyNames: OfferingTermsPrimaryKeyNames,
    indexes: [["cik"]],
  }),
  defineStorage({
    token: SPAC_UNIT_TERMS_REPOSITORY_TOKEN,
    table: "spac_unit_terms",
    schema: SpacUnitTermsSchema,
    primaryKeyNames: SpacUnitTermsPrimaryKeyNames,
    indexes: [["cik"]],
  }),
  defineStorage({
    token: SPAC_PROMOTE_TERMS_REPOSITORY_TOKEN,
    table: "spac_promote_terms",
    schema: SpacPromoteTermsSchema,
    primaryKeyNames: SpacPromoteTermsPrimaryKeyNames,
    indexes: [["cik"]],
  }),
  defineStorage({
    token: SPAC_LOCKUP_TERMS_REPOSITORY_TOKEN,
    table: "spac_lockup_terms",
    schema: SpacLockupTermsSchema,
    primaryKeyNames: SpacLockupTermsPrimaryKeyNames,
    indexes: [["cik"]],
  }),
  defineStorage({
    token: ISSUER_TICKER_REPOSITORY_TOKEN,
    table: "issuer_ticker",
    schema: IssuerTickerSchema,
    primaryKeyNames: IssuerTickerPrimaryKeyNames,
    indexes: [["cik"], ["accession_number"]],
  }),
  defineStorage({
    token: CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN,
    table: "canonical_underwriter_family",
    schema: CanonicalUnderwriterFamilySchema,
    primaryKeyNames: CanonicalUnderwriterFamilyPrimaryKeyNames,
    indexes: [],
    // (resolver_version, normalized_name) is the family natural key — must be
    // enforced at the storage layer so two processes racing to mint the same
    // family converge on one row. Without this, the family-tier identity
    // tables silently forked under multi-process load.
    uniqueIndexes: [["resolver_version", "normalized_name"]],
  }),
  defineStorage({
    token: CANONICAL_UNDERWRITER_FAMILY_ALIAS_REPOSITORY_TOKEN,
    table: "canonical_underwriter_family_alias",
    schema: CanonicalUnderwriterFamilyAliasSchema,
    primaryKeyNames: CanonicalUnderwriterFamilyAliasPrimaryKeyNames,
    indexes: [["target_canonical_id"]],
  }),
  defineStorage({
    token: UNDERWRITER_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN,
    table: "underwriter_family_membership",
    schema: UnderwriterFamilyMembershipSchema,
    primaryKeyNames: UnderwriterFamilyMembershipPrimaryKeyNames,
    indexes: [["resolver_version", "canonical_underwriter_family_id"]],
  }),
  defineStorage({
    token: UNDERWRITER_LINK_REPOSITORY_TOKEN,
    table: "underwriter_link",
    schema: UnderwriterLinkSchema,
    primaryKeyNames: UnderwriterLinkPrimaryKeyNames,
    // Mirrors spac_sponsor_link: issuer-led so the per-issuer read at the
    // active resolver version does not scan the table.
    indexes: [["accession_number"], ["underwriter_family_id"], ["issuer_cik", "resolver_version"]],
  }),
  defineStorage({
    token: RISK_FACTOR_REPOSITORY_TOKEN,
    table: "risk_factor",
    schema: RiskFactorSchema,
    primaryKeyNames: RiskFactorPrimaryKeyNames,
    indexes: [["accession_number"], ["cik"]],
  }),
  defineStorage({
    token: USE_OF_PROCEEDS_REPOSITORY_TOKEN,
    table: "use_of_proceeds",
    schema: UseOfProceedsSchema,
    primaryKeyNames: UseOfProceedsPrimaryKeyNames,
    indexes: [["accession_number"]],
  }),
  defineStorage({
    token: XBRL_FACT_REPOSITORY_TOKEN,
    table: "xbrl_fact",
    schema: XbrlFactRowSchema,
    primaryKeyNames: XbrlFactPrimaryKeyNames,
    indexes: [["cik"], ["concept"]],
  }),
  // ------------------------------ Form 8-K Events --------------------------------
  defineStorage({
    token: FORM_8K_EVENT_REPOSITORY_TOKEN,
    table: "form_8k_events",
    schema: Form8KEventSchema,
    primaryKeyNames: Form8KEventPrimaryKeyNames,
    indexes: [
      ["cik", "filing_date"],
      ["item_code"],
      ["accession_number"],
      ["extractor_id", "extractor_version"],
    ],
    uniqueIndexes: Form8KEventUniqueIndexes,
  }),
];
