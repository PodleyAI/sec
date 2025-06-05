//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Type, Static } from "@sinclair/typebox";
import {
  TRUE_FALSE_LIST,
  RELATIONSHIP_LIST,
  STRING_150_TYPE,
  STRING_200_TYPE,
  ENTITY_NAME_TYPE,
  YEAR_VALUE_TYPE,
  CIK_TYPE,
  STRING_255_TYPE,
  IS_TRUE_TYPE,
  TEST_LIVE_LIST,
  POSITIVE_INTEGER_TYPE,
  SCHEMA_VERSION_TYPE,
  PHONE_NUMBER_TYPE,
  STRING_50_TYPE,
  ENTITY_TYPE_LIST,
  ACCESSION_NUMBER_TYPE,
  STREET_TYPE,
  CITY_TYPE,
  ZIP_CODE_TYPE,
} from "../FormSchemaUtil";
import { STATE_COUNTRY_CODE } from "../../../storage/address/AddressSchema";

export const SubTypeList = Type.Union([Type.Literal("D"), Type.Literal("D/A")], {
  description: "Submission Type Form",
});

// Industry group enums
const AGRICULTURE_INDUSTRY_LIST = Type.Union([Type.Literal("Agriculture")]);

const BANKING_FINANCIAL_INDUSTRY_LIST = Type.Union([
  Type.Literal("Commercial Banking"),
  Type.Literal("Insurance"),
  Type.Literal("Investing"),
  Type.Literal("Investment Banking"),
  Type.Literal("Pooled Investment Fund"),
  Type.Literal("Other Banking and Financial Services"),
]);

const INVESTMENT_FUND_LIST = Type.Union([
  Type.Literal("Hedge Fund"),
  Type.Literal("Private Equity Fund"),
  Type.Literal("Venture Capital Fund"),
  Type.Literal("Other Investment Fund"),
]);

const BUSINESS_SERVICES_LIST = Type.Union([Type.Literal("Business Services")]);

const ENERGY_INDUSTRY_LIST = Type.Union([
  Type.Literal("Coal Mining"),
  Type.Literal("Electric Utilities"),
  Type.Literal("Energy Conservation"),
  Type.Literal("Environmental Services"),
  Type.Literal("Oil and Gas"),
  Type.Literal("Other Energy"),
]);

const HEALTH_CARE_INDUSTRY_LIST = Type.Union([
  Type.Literal("Biotechnology"),
  Type.Literal("Health Insurance"),
  Type.Literal("Hospitals and Physicians"),
  Type.Literal("Pharmaceuticals"),
  Type.Literal("Other Health Care"),
]);

const MANUFACTURING_INDUSTRY_LIST = Type.Union([Type.Literal("Manufacturing")]);

const REAL_ESTATE_INDUSTRY_LIST = Type.Union([
  Type.Literal("Commercial"),
  Type.Literal("Construction"),
  Type.Literal("REITS and Finance"),
  Type.Literal("Residential"),
  Type.Literal("Other Real Estate"),
]);

const RETAILING_INDUSTRY_LIST = Type.Union([Type.Literal("Retailing")]);
const RESTAURANTS_INDUSTRY_LIST = Type.Union([Type.Literal("Restaurants")]);

const TECHNOLOGY_INDUSTRY_LIST = Type.Union([
  Type.Literal("Computers"),
  Type.Literal("Telecommunications"),
  Type.Literal("Other Technology"),
]);

const TRAVEL_INDUSTRY_LIST = Type.Union([
  Type.Literal("Airlines and Airports"),
  Type.Literal("Lodging and Conventions"),
  Type.Literal("Tourism and Travel Services"),
  Type.Literal("Other Travel"),
]);

const OTHER_INDUSTRY_LIST = Type.Union([Type.Literal("Other")]);

const INDUSTRY_GROUP_LIST = Type.Union([
  AGRICULTURE_INDUSTRY_LIST,
  BANKING_FINANCIAL_INDUSTRY_LIST,
  BUSINESS_SERVICES_LIST,
  ENERGY_INDUSTRY_LIST,
  HEALTH_CARE_INDUSTRY_LIST,
  MANUFACTURING_INDUSTRY_LIST,
  REAL_ESTATE_INDUSTRY_LIST,
  RETAILING_INDUSTRY_LIST,
  RESTAURANTS_INDUSTRY_LIST,
  TECHNOLOGY_INDUSTRY_LIST,
  TRAVEL_INDUSTRY_LIST,
  OTHER_INDUSTRY_LIST,
]);

// Federal exemption codes
const STANDARD_LIST = Type.Union([
  Type.Literal("04"),
  Type.Literal("04.1"),
  Type.Literal("04.2"),
  Type.Literal("04.3"),
  Type.Literal("05"),
  Type.Literal("06"),
  Type.Literal("06b"),
  Type.Literal("06c"),
  Type.Literal("46"),
  Type.Literal("4a5"),
  Type.Literal("3C"),
]);

const SECTION_3C_LIST = Type.Union([
  Type.Literal("3C.1"),
  Type.Literal("3C.2"),
  Type.Literal("3C.3"),
  Type.Literal("3C.4"),
  Type.Literal("3C.5"),
  Type.Literal("3C.6"),
  Type.Literal("3C.7"),
  Type.Literal("3C.9"),
  Type.Literal("3C.10"),
  Type.Literal("3C.11"),
  Type.Literal("3C.12"),
  Type.Literal("3C.13"),
  Type.Literal("3C.14"),
]);

const FEDERAL_EXEMPTION_LIST = Type.Union([STANDARD_LIST, SECTION_3C_LIST]);

// Revenue and asset value ranges
const REVENUE_RANGE_TYPE = Type.Union([
  Type.Literal("No Revenues"),
  Type.Literal("$1 - $1,000,000"),
  Type.Literal("$1,000,001 - $5,000,000"),
  Type.Literal("$5,000,001 - $25,000,000"),
  Type.Literal("$25,000,001 - $100,000,000"),
  Type.Literal("Over $100,000,000"),
  Type.Literal("Decline to Disclose"),
  Type.Literal("Not Applicable"),
]);

const AGGREGATE_NET_ASSET_VALUE_RANGE_TYPE = Type.Union([
  Type.Literal("No Aggregate Net Asset Value"),
  Type.Literal("$1 - $5,000,000"),
  Type.Literal("$5,000,001 - $25,000,000"),
  Type.Literal("$25,000,001 - $50,000,000"),
  Type.Literal("$50,000,001 - $100,000,000"),
  Type.Literal("Over $100,000,000"),
  Type.Literal("Decline to Disclose"),
  Type.Literal("Not Applicable"),
]);

// Specific format types
const CRD_NUMBER_TYPE = Type.Union([
  Type.Literal("None"),
  Type.String({ pattern: "^\\d+$", maxLength: 9 }),
]);

export const INDEFINITE = "Indefinite";
const AMOUNT_OR_INDEFINITE = Type.Union([
  Type.Literal(INDEFINITE),
  Type.String({ pattern: "^\\d+$", maxLength: 12 }),
]);

const FORM_D_EMAIL_TYPE = Type.String({
  minLength: 1,
  pattern:
    "^([a-zA-Z0-9_\\-\\.]+)@((\\[[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.)|(([a-zA-Z0-9\\-]+\\.)+))([a-zA-Z]{2,7}|[0-9]{1,3})(\\]?)$",
});

export const STATE_SOLICITATION_CODE = Type.Union(
  [
    Type.Literal("AL"),
    Type.Literal("AK"),
    Type.Literal("AZ"),
    Type.Literal("AR"),
    Type.Literal("CA"),
    Type.Literal("CO"),
    Type.Literal("CT"),
    Type.Literal("DE"),
    Type.Literal("FL"),
    Type.Literal("GA"),
    Type.Literal("HI"),
    Type.Literal("ID"),
    Type.Literal("IL"),
    Type.Literal("IN"),
    Type.Literal("IA"),
    Type.Literal("KS"),
    Type.Literal("KY"),
    Type.Literal("LA"),
    Type.Literal("ME"),
    Type.Literal("MD"),
    Type.Literal("MA"),
    Type.Literal("MI"),
    Type.Literal("MN"),
    Type.Literal("MS"),
    Type.Literal("MO"),
    Type.Literal("MT"),
    Type.Literal("NE"),
    Type.Literal("NV"),
    Type.Literal("NH"),
    Type.Literal("NJ"),
    Type.Literal("NM"),
    Type.Literal("NY"),
    Type.Literal("NC"),
    Type.Literal("ND"),
    Type.Literal("OH"),
    Type.Literal("OK"),
    Type.Literal("OR"),
    Type.Literal("PA"),
    Type.Literal("RI"),
    Type.Literal("SC"),
    Type.Literal("SD"),
    Type.Literal("TN"),
    Type.Literal("TX"),
    Type.Literal("UT"),
    Type.Literal("VT"),
    Type.Literal("VA"),
    Type.Literal("WA"),
    Type.Literal("WV"),
    Type.Literal("WI"),
    Type.Literal("WY"),
    Type.Literal("PR"),
  ],
  { description: "Two‐character US state code or PR" }
);

export const ALL_STATES = "All States";
export const STATE_SOLICITATION_CODE_TYPE = Type.Union(
  [Type.Literal(ALL_STATES), Type.Array(STATE_SOLICITATION_CODE, { minItems: 1 })],
  { description: "All States or array of state codes" }
);

export const FORMD_ADDRESS_TYPE = Type.Object({
  street1: STREET_TYPE,
  street2: Type.Optional(STREET_TYPE),
  city: CITY_TYPE,
  stateOrCountry: STATE_COUNTRY_CODE,
  stateOrCountryDescription: Type.Optional(STRING_50_TYPE),
  zipCode: ZIP_CODE_TYPE,
});

export type FormDAddress = Static<typeof FORMD_ADDRESS_TYPE>;

/** ---------- Reusable Complex Types ---------- **/

const FORM_D_POINT_OF_CONTACT_TYPE = Type.Object({
  contactName: Type.String({ minLength: 1, maxLength: 30 }),
  contactPhoneNumber: Type.String({ minLength: 1, maxLength: 20 }),
  contactEmailAddress: FORM_D_EMAIL_TYPE,
});

const FORM_D_NOTIFY_GROUP_TYPE = Type.Object({
  notificationEmailAddress: Type.Optional(Type.Array(FORM_D_EMAIL_TYPE, { maxItems: 3 })),
});

const INVESTMENT_FUND_TYPE = Type.Object({
  investmentFundType: INVESTMENT_FUND_LIST,
  is40Act: TRUE_FALSE_LIST,
});

const INDUSTRY_GROUP_TYPE = Type.Object({
  industryGroupType: INDUSTRY_GROUP_LIST,
  investmentFundInfo: Type.Optional(INVESTMENT_FUND_TYPE),
});

const RELATIONSHIP_LIST_TYPE = Type.Object({
  relationship: Type.Array(RELATIONSHIP_LIST, { maxItems: 3 }),
});

const NAME_TYPE = Type.Object({
  firstName: STRING_150_TYPE,
  middleName: Type.Optional(STRING_150_TYPE),
  lastName: STRING_150_TYPE,
});

const NAME_TYPE_W_LAST_NAME_200 = Type.Object({
  firstName: STRING_150_TYPE,
  middleName: Type.Optional(STRING_150_TYPE),
  lastName: STRING_200_TYPE,
});

const NAMES_LIST_TYPE = Type.Union([
  Type.Object({ value: Type.Literal("None") }),
  Type.Object({ previousName: Type.Optional(Type.Array(ENTITY_NAME_TYPE, { maxItems: 3 })) }),
]);

const YEAR_INC_TYPE = Type.Object({
  ...Type.Union([
    Type.Object({ withinFiveYears: IS_TRUE_TYPE }),
    Type.Object({ yetToBeFormed: IS_TRUE_TYPE }),
    Type.Object({ overFiveYears: IS_TRUE_TYPE }),
  ]).properties!,
  value: Type.Optional(YEAR_VALUE_TYPE),
});

const FILED_BY_COMPANY_FORMD_TYPE = Type.Object({
  cik: CIK_TYPE,
  ccc: Type.Optional(Type.String({ minLength: 8, maxLength: 8 })),
  entityName: Type.Optional(ENTITY_NAME_TYPE),
});

const ISSUER_TYPE = Type.Composite([
  FILED_BY_COMPANY_FORMD_TYPE,
  Type.Object({
    issuerAddress: FORMD_ADDRESS_TYPE,
    issuerPhoneNumber: PHONE_NUMBER_TYPE,
    jurisdictionOfInc: Type.Optional(STRING_50_TYPE),
    issuerPreviousNameList: Type.Optional(NAMES_LIST_TYPE),
    edgarPreviousNameList: Type.Optional(NAMES_LIST_TYPE),
    entityType: ENTITY_TYPE_LIST,
    entityTypeOtherDesc: Type.Optional(STRING_255_TYPE),
    yearOfInc: YEAR_INC_TYPE,
  }),
]);

export type Issuer = Static<typeof ISSUER_TYPE>;

const ADDITIONAL_ISSUER_TYPE = Type.Object({
  issuer: Type.Array(ISSUER_TYPE, { maxItems: 99 }),
  over100IssuerFlag: Type.Optional(IS_TRUE_TYPE),
});

const RELATED_PERSON_INFO_TYPE = Type.Object({
  relatedPersonName: NAME_TYPE_W_LAST_NAME_200,
  relatedPersonAddress: FORMD_ADDRESS_TYPE,
  relatedPersonRelationshipList: RELATIONSHIP_LIST_TYPE,
  relationshipClarification: Type.Optional(STRING_255_TYPE),
});

export type RelatedPerson = Static<typeof RELATED_PERSON_INFO_TYPE>;

const RELATED_PERSONS_LIST = Type.Object({
  relatedPersonInfo: Type.Array(RELATED_PERSON_INFO_TYPE, { maxItems: 100 }),
  over100PersonsFlag: Type.Optional(IS_TRUE_TYPE),
});

const ISSUER_SIZE_TYPE = Type.Union([
  Type.Object({ revenueRange: REVENUE_RANGE_TYPE }),
  Type.Object({ aggregateNetAssetValueRange: AGGREGATE_NET_ASSET_VALUE_RANGE_TYPE }),
]);

const FED_EXEMPT_EXCLUDE_TYPE = Type.Object({
  item: Type.Array(FEDERAL_EXEMPTION_LIST, { minItems: 1, maxItems: 21 }),
});

const FIRST_SALE_DATE_TYPE = Type.Union([
  Type.Object({ value: Type.String({ format: "date" }) }),
  Type.Object({ yetToOccur: IS_TRUE_TYPE }),
]);

const FORMD_AMENDMENT_TYPE = Type.Object({
  isAmendment: TRUE_FALSE_LIST,
  previousAccessionNumber: Type.Optional(ACCESSION_NUMBER_TYPE),
});

const FILING_TYPE = Type.Object({
  newOrAmendment: FORMD_AMENDMENT_TYPE,
  dateOfFirstSale: FIRST_SALE_DATE_TYPE,
});

const OFFERING_DURATION_TYPE = Type.Object({
  moreThanOneYear: TRUE_FALSE_LIST,
});

const SECURITIES_OFFERED_TYPE = Type.Object({
  isEquityType: Type.Optional(IS_TRUE_TYPE),
  isDebtType: Type.Optional(IS_TRUE_TYPE),
  isOptionToAcquireType: Type.Optional(IS_TRUE_TYPE),
  isSecurityToBeAcquiredType: Type.Optional(IS_TRUE_TYPE),
  isPooledInvestmentFundType: Type.Optional(IS_TRUE_TYPE),
  isTenantInCommonType: Type.Optional(IS_TRUE_TYPE),
  isMineralPropertyType: Type.Optional(IS_TRUE_TYPE),
  isOtherType: Type.Optional(IS_TRUE_TYPE),
  descriptionOfOtherType: Type.Optional(STRING_255_TYPE),
});

const BUSINESS_COMBINATION_TRANSACTION_TYPE = Type.Object({
  isBusinessCombinationTransaction: TRUE_FALSE_LIST,
  clarificationOfResponse: Type.Optional(STRING_255_TYPE),
});

const STATE_SOLICITATION_GROUP = Type.Object({
  state: STATE_SOLICITATION_CODE_TYPE,
  description: Type.Optional(STRING_50_TYPE),
});

const STATES_OF_SOLICITATION_LIST = Type.Union([
  Type.Array(STATE_SOLICITATION_GROUP),
  Type.Object({ value: Type.Literal("All States") }),
]);

const BD_NAME_TYPE_200 = Type.Union([Type.Literal("None"), STRING_200_TYPE]);

const SALES_COMPENSATION_TYPE = Type.Object({
  recipientName: STRING_200_TYPE,
  recipientCRDNumber: CRD_NUMBER_TYPE,
  associatedBDName: BD_NAME_TYPE_200,
  associatedBDCRDNumber: CRD_NUMBER_TYPE,
  recipientAddress: FORMD_ADDRESS_TYPE,
  statesOfSolicitationList: STATES_OF_SOLICITATION_LIST,
  foreignSolicitation: Type.Optional(TRUE_FALSE_LIST),
});

const SALES_COMPENSATION_LIST = Type.Object({
  recipient: Type.Optional(Type.Array(SALES_COMPENSATION_TYPE, { maxItems: 100 })),
  over100RecipientFlag: Type.Optional(IS_TRUE_TYPE),
});

const OFFERING_SALES_AMOUNTS_TYPE = Type.Object({
  totalOfferingAmount: AMOUNT_OR_INDEFINITE,
  totalAmountSold: POSITIVE_INTEGER_TYPE,
  totalRemaining: AMOUNT_OR_INDEFINITE,
  clarificationOfResponse: Type.Optional(STRING_255_TYPE),
});

const INVESTORS_TYPE = Type.Object({
  hasNonAccreditedInvestors: TRUE_FALSE_LIST,
  numberNonAccreditedInvestors: Type.Optional(POSITIVE_INTEGER_TYPE),
  totalNumberAlreadyInvested: POSITIVE_INTEGER_TYPE,
});

const AMOUNT_ESTIMATE_TYPE = Type.Object({
  dollarAmount: POSITIVE_INTEGER_TYPE,
  isEstimate: Type.Optional(IS_TRUE_TYPE),
});

const COMMISSION_FEE_TYPE = Type.Object({
  salesCommissions: AMOUNT_ESTIMATE_TYPE,
  findersFees: AMOUNT_ESTIMATE_TYPE,
  clarificationOfResponse: Type.Optional(STRING_255_TYPE),
});

const PROCEEDS_USE_TYPE = Type.Object({
  grossProceedsUsed: AMOUNT_ESTIMATE_TYPE,
  clarificationOfResponse: Type.Optional(STRING_255_TYPE),
});

const SIGNATURE_TYPE = Type.Object({
  issuerName: ENTITY_NAME_TYPE,
  signatureName: Type.String({ minLength: 1, maxLength: 30 }),
  nameOfSigner: ENTITY_NAME_TYPE,
  signatureTitle: Type.String({ minLength: 1, maxLength: 60 }),
  signatureDate: Type.String({ format: "date" }),
});

export type Signature = Static<typeof SIGNATURE_TYPE>;

const SIGNATURE_BLOCK_TYPE = Type.Object({
  authorizedRepresentative: Type.Optional(TRUE_FALSE_LIST),
  signature: Type.Array(SIGNATURE_TYPE, { maxItems: 101 }),
});

export type SignatureBlock = Static<typeof SIGNATURE_BLOCK_TYPE>;

const OFFERING_DATA_TYPE = Type.Object({
  industryGroup: INDUSTRY_GROUP_TYPE,
  issuerSize: ISSUER_SIZE_TYPE,
  federalExemptionsExclusions: FED_EXEMPT_EXCLUDE_TYPE,
  typeOfFiling: FILING_TYPE,
  durationOfOffering: OFFERING_DURATION_TYPE,
  typesOfSecuritiesOffered: SECURITIES_OFFERED_TYPE,
  businessCombinationTransaction: BUSINESS_COMBINATION_TRANSACTION_TYPE,
  minimumInvestmentAccepted: POSITIVE_INTEGER_TYPE,
  salesCompensationList: SALES_COMPENSATION_LIST,
  offeringSalesAmounts: OFFERING_SALES_AMOUNTS_TYPE,
  investors: INVESTORS_TYPE,
  salesCommissionsFindersFees: COMMISSION_FEE_TYPE,
  useOfProceeds: PROCEEDS_USE_TYPE,
  signatureBlock: SIGNATURE_BLOCK_TYPE,
});
export type OfferingData = Static<typeof OFFERING_DATA_TYPE>;

// Main Form D schema
export const FormDSchema = Type.Object({
  schemaVersion: Type.Optional(SCHEMA_VERSION_TYPE),
  submissionType: SubTypeList,
  testOrLive: Type.Optional(TEST_LIVE_LIST),
  returnCopy: Type.Optional(TRUE_FALSE_LIST),
  contactData: Type.Optional(FORM_D_POINT_OF_CONTACT_TYPE),
  notificationAddressList: Type.Optional(FORM_D_NOTIFY_GROUP_TYPE),
  primaryIssuer: ISSUER_TYPE,
  issuerList: Type.Optional(ADDITIONAL_ISSUER_TYPE),
  relatedPersonsList: RELATED_PERSONS_LIST,
  offeringData: OFFERING_DATA_TYPE,
});

export type FormD = Static<typeof FormDSchema>;

/** ---------- Root Schema ---------- **/
export const FormDSubmissionSchema = Type.Object({
  edgarSubmission: FormDSchema,
});

export type FormDSubmission = Static<typeof FormDSubmissionSchema>;
