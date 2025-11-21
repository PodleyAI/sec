//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Type, Static } from "typebox";
import {
  TRUE_FALSE_LIST,
  STRING_150_TYPE,
  STRING_255_TYPE,
  ENTITY_NAME_TYPE,
  CIK_TYPE,
  SCHEMA_VERSION_TYPE,
  PHONE_NUMBER_TYPE,
  EMAIL_TYPE,
  STREET_TYPE,
  CITY_TYPE,
  ZIP_CODE_TYPE,
  YEAR_VALUE_TYPE,
} from "../FormSchemaUtil";
import { STATE_COUNTRY_CODE } from "../../../storage/address/AddressSchema";

export const SUBMISSION_TYPE = Type.Union([
  Type.Literal("1-A"),
  Type.Literal("1-A/A"),
  Type.Literal("DOS"),
  Type.Literal("DOS/A"),
  Type.Literal("1-A POS"),
]);

export const DISCLOSE_TYPE = Type.Union([
  Type.Literal("Pro-rate basis"),
  Type.Literal("First-come, first served basis"),
  Type.Literal("Other"),
]);

export const TIER_TYPE = Type.Union([Type.Literal("Tier1"), Type.Literal("Tier2")]);

export const SECURITIES_OFFERED_TYPE = Type.Union([
  Type.Literal("Equity (common or preferred stock)"),
  Type.Literal("Debt"),
  Type.Literal("Option, warrant or other right to acquire another security"),
  Type.Literal(
    "Security to be acquired upon exercise of option, warrant or other right to acquire security"
  ),
  Type.Literal("Tenant-in-common securities"),
  Type.Literal("Other(describe)"),
]);

export const INDUSTRY_GROUP_TYPE = Type.Union([
  Type.Literal("Banking"),
  Type.Literal("Insurance"),
  Type.Literal("Other"),
]);

export const STATEMENT_AUDIT_STATUS_TYPE = Type.Union([
  Type.Literal("Unaudited"),
  Type.Literal("Audited"),
]);

export const YES_NO_TYPE = Type.Union([Type.Literal("Y"), Type.Literal("N")]);

// Common types based on XSD
const CCC_TYPE = Type.String({ minLength: 8, maxLength: 8 });
const FILE_NUMBER_TYPE = Type.String({ minLength: 1, maxLength: 17 });
const FILE_NUMBER_TYPE_2 = Type.String({ minLength: 1, maxLength: 17 });
const DECIMAL_TYPE13_2 = Type.Number();
const DECIMAL_TYPE13_4 = Type.Number();
const DECIMAL_TYPE14_2 = Type.Number();
const DECIMAL_TYPE14_4 = Type.Number();
const INTEGER_NONNEGATIVE_13 = Type.Integer({ minimum: 0, maximum: 9999999999999 });
const INTEGER_NONNEGATIVE_7 = Type.Integer({ minimum: 0, maximum: 9999999 });
const INTEGER_TYPE_4 = Type.Integer({ minimum: 1, maximum: 9999 });
const IRS_NUMBER_TYPE = Type.String({ pattern: "^\\d{2}-\\d{7}$" });
const STRING_30_TYPE = Type.String({ minLength: 1, maxLength: 30 });
const STRING_50_TYPE = Type.String({ minLength: 1, maxLength: 50 });
const YEAR_TYPE = Type.Integer({ minimum: 1900, maximum: 2100 });
const EDGAR_PHONE_TYPE = Type.String({ minLength: 1, maxLength: 20 });

const ISSUER_CREDENTIALS_TYPE = Type.Object({
  cik: CIK_TYPE,
  ccc: CCC_TYPE,
});

const CO_ISSUER_CREDENTIALS_TYPE = Type.Object({
  cik: Type.Optional(CIK_TYPE),
  ccc: Type.Optional(CCC_TYPE),
});

const FILER_TYPE = Type.Object({
  issuerCredentials: ISSUER_CREDENTIALS_TYPE,
  dosFileNumber: Type.Optional(FILE_NUMBER_TYPE),
  offeringFileNumber: Type.Optional(FILE_NUMBER_TYPE),
});

const FLAGS_TYPE = Type.Object({
  returnCopyFlag: Type.Optional(TRUE_FALSE_LIST),
  overrideInternetFlag: Type.Optional(TRUE_FALSE_LIST),
  sinceLastFiling: Type.Optional(TRUE_FALSE_LIST),
});

const CONTACT_TYPE = Type.Object({
  contactName: Type.Optional(ENTITY_NAME_TYPE),
  contactPhoneNumber: Type.Optional(EDGAR_PHONE_TYPE),
  contactEmailAddress: Type.Optional(EMAIL_TYPE),
});

const NOTIFICATIONS_TYPE = Type.Object({
  notificationEmailAddress: Type.Optional(Type.Array(EMAIL_TYPE, { maxItems: 3 })),
});

const CO_FILER_TYPE = Type.Object({
  coIssuerCredentials: Type.Optional(CO_ISSUER_CREDENTIALS_TYPE),
  coIssuerFileNumber: Type.Optional(FILE_NUMBER_TYPE_2),
});

const FILER_INFO_TYPE = Type.Object({
  liveTestFlag: Type.Union([Type.Literal("LIVE"), Type.Literal("TEST")]),
  filer: FILER_TYPE,
  flags: Type.Optional(FLAGS_TYPE),
  contact: Type.Optional(CONTACT_TYPE),
  notifications: Type.Optional(NOTIFICATIONS_TYPE),
});

const CO_ISSUER_INFO_TYPE = Type.Object({
  "co-filer": Type.Optional(Type.Array(CO_FILER_TYPE, { maxItems: 15 })),
});

const EMPLOYEES_INFO_TYPE = Type.Object({
  issuerName: STRING_150_TYPE,
  jurisdictionOrganization: STATE_COUNTRY_CODE,
  yearIncorporation: YEAR_TYPE,
  cik: CIK_TYPE,
  sicCode: INTEGER_TYPE_4,
  irsNum: IRS_NUMBER_TYPE,
  fullTimeEmployees: INTEGER_NONNEGATIVE_7,
  partTimeEmployees: INTEGER_NONNEGATIVE_7,
});

const ISSUER_INFO_TYPE = Type.Object({
  street1: STREET_TYPE,
  street2: Type.Optional(STREET_TYPE),
  city: STRING_30_TYPE,
  stateOrCountry: STATE_COUNTRY_CODE,
  zipCode: ZIP_CODE_TYPE,
  phoneNumber: PHONE_NUMBER_TYPE,
  connectionName: ENTITY_NAME_TYPE,
  connectionStreet1: Type.Optional(STREET_TYPE),
  connectionStreet2: Type.Optional(STREET_TYPE),
  connectionCity: Type.Optional(STRING_30_TYPE),
  connectionStateOrCountry: Type.Optional(STATE_COUNTRY_CODE),
  connectionZipCode: Type.Optional(ZIP_CODE_TYPE),
  connectionPhoneNumber: Type.Optional(EDGAR_PHONE_TYPE),
  commentsEmailAddress: Type.Optional(Type.Array(EMAIL_TYPE, { maxItems: 2 })),
  industryGroup: INDUSTRY_GROUP_TYPE,
  cashEquivalents: DECIMAL_TYPE13_2,
  investmentSecurities: Type.Optional(DECIMAL_TYPE13_2),
  totalInvestments: Type.Optional(DECIMAL_TYPE13_2),
  accountsReceivable: Type.Optional(DECIMAL_TYPE13_2),
  loans: Type.Optional(DECIMAL_TYPE13_2),
  propertyPlantEquipment: Type.Optional(DECIMAL_TYPE13_2),
  propertyAndEquipment: Type.Optional(DECIMAL_TYPE13_2),
  totalAssets: DECIMAL_TYPE13_2,
  accountsPayable: DECIMAL_TYPE13_2,
  policyLiabilitiesAndAccruals: Type.Optional(DECIMAL_TYPE13_2),
  deposits: Type.Optional(DECIMAL_TYPE13_2),
  longTermDebt: DECIMAL_TYPE13_2,
  totalLiabilities: DECIMAL_TYPE14_2,
  totalStockholderEquity: DECIMAL_TYPE13_2,
  totalLiabilitiesAndEquity: DECIMAL_TYPE13_2,
  totalRevenues: Type.Optional(DECIMAL_TYPE13_2),
  totalInterestIncome: Type.Optional(DECIMAL_TYPE13_2),
  costAndExpensesApplToRevenues: Type.Optional(DECIMAL_TYPE13_2),
  totalInterestExpenses: Type.Optional(DECIMAL_TYPE13_2),
  depreciationAndAmortization: DECIMAL_TYPE13_2,
  netIncome: DECIMAL_TYPE13_2,
  earningsPerShareBasic: DECIMAL_TYPE13_2,
  earningsPerShareDiluted: DECIMAL_TYPE13_2,
  nameAuditor: Type.Optional(STRING_150_TYPE),
});

const COMMON_EQUITY_TYPE = Type.Object({
  commonEquityClassName: Type.Optional(STRING_30_TYPE),
  outstandingCommonEquity: INTEGER_NONNEGATIVE_13,
  commonCusipEquity: Type.Optional(Type.String({ minLength: 1, maxLength: 9 })),
  publiclyTradedCommonEquity: Type.Optional(STRING_50_TYPE),
});

const PREFERRED_EQUITY_TYPE = Type.Object({
  preferredEquityClassName: Type.Optional(STRING_30_TYPE),
  outstandingPreferredEquity: INTEGER_NONNEGATIVE_13,
  preferredCusipEquity: Type.Optional(Type.String({ minLength: 1, maxLength: 9 })),
  publiclyTradedPreferredEquity: Type.Optional(STRING_50_TYPE),
});

const DEBT_SECURITIES_TYPE = Type.Object({
  debtSecuritiesClassName: Type.Optional(STRING_30_TYPE),
  outstandingDebtSecurities: INTEGER_NONNEGATIVE_13,
  cusipDebtSecurities: Type.Optional(Type.String({ minLength: 1, maxLength: 9 })),
  publiclyTradedDebtSecurities: Type.Optional(STRING_50_TYPE),
});

const ISSUER_ELIGIBILITY_TYPE = Type.Object({
  certifyIfTrue: TRUE_FALSE_LIST,
});

const APPLICATION_RULE262_TYPE = Type.Object({
  certifyIfNotDisqualified: TRUE_FALSE_LIST,
  certifyIfBadActor: Type.Optional(TRUE_FALSE_LIST),
});

const SUMMARY_INFO_TYPE = Type.Object({
  indicateTier1Tier2Offering: TIER_TYPE,
  financialStatementAuditStatus: STATEMENT_AUDIT_STATUS_TYPE,
  securitiesOfferedTypes: SECURITIES_OFFERED_TYPE,
  securitiesOfferedOtherDesc: Type.Optional(STRING_255_TYPE),
  offerDelayedContinuousFlag: YES_NO_TYPE,
  offeringYearFlag: YES_NO_TYPE,
  offeringAfterQualifFlag: YES_NO_TYPE,
  offeringBestEffortsFlag: YES_NO_TYPE,
  solicitationProposedOfferingFlag: YES_NO_TYPE,
  resaleSecuritiesAffiliatesFlag: YES_NO_TYPE,
  securitiesOffered: INTEGER_NONNEGATIVE_13,
  outstandingSecurities: Type.Optional(INTEGER_NONNEGATIVE_13),
  pricePerSecurity: Type.Optional(DECIMAL_TYPE13_4),
  issuerAggregateOffering: DECIMAL_TYPE13_2,
  securityHolderAggegate: DECIMAL_TYPE13_2,
  qualificationOfferingAggregate: DECIMAL_TYPE13_2,
  concurrentOfferingAggregate: DECIMAL_TYPE13_2,
  totalAggregateOffering: DECIMAL_TYPE14_2,
  underwritersServiceProviderName: Type.Optional(STRING_150_TYPE),
  underwritersFees: Type.Optional(DECIMAL_TYPE13_2),
  salesCommissionsServiceProviderName: Type.Optional(STRING_150_TYPE),
  salesCommissionsServiceProviderFees: Type.Optional(DECIMAL_TYPE13_2),
  findersFeesServiceProviderName: Type.Optional(STRING_150_TYPE),
  finderFeesFee: Type.Optional(DECIMAL_TYPE13_2),
  auditorServiceProviderName: Type.Optional(STRING_150_TYPE),
  auditorFees: Type.Optional(DECIMAL_TYPE13_2),
  legalServiceProviderName: Type.Optional(STRING_150_TYPE),
  legalFees: Type.Optional(DECIMAL_TYPE13_2),
  promotersServiceProviderName: Type.Optional(STRING_150_TYPE),
  promotersFees: Type.Optional(DECIMAL_TYPE13_2),
  blueSkyServiceProviderName: Type.Optional(STRING_150_TYPE),
  blueSkyFees: Type.Optional(DECIMAL_TYPE13_2),
  brokerDealerCrdNumber: Type.Optional(Type.String({ maxLength: 9 })),
  estimatedNetAmount: Type.Optional(DECIMAL_TYPE13_2),
  clarificationResponses: Type.Optional(STRING_255_TYPE),
});

const JURIDICTION_SECURITIES_OFFERED_TYPE = Type.Object({
  jurisdictionsOfSecOfferedNone: Type.Optional(TRUE_FALSE_LIST),
  jurisdictionsOfSecOfferedSame: Type.Optional(TRUE_FALSE_LIST),
  issueJuridicationSecuritiesOffering: Type.Optional(
    Type.Array(STATE_COUNTRY_CODE, { maxItems: 64 })
  ),
  dealersJuridicationSecuritiesOffering: Type.Optional(
    Type.Array(STATE_COUNTRY_CODE, { maxItems: 64 })
  ),
});

const UNREGISTERED_SECURITIES_TYPE = Type.Object({
  ifUnregsiteredNone: Type.Optional(TRUE_FALSE_LIST),
});

const SECURITIES_ISSUED_TYPE = Type.Object({
  securitiesIssuerName: Type.Optional(STRING_150_TYPE),
  securitiesIssuerTitle: Type.Optional(STRING_255_TYPE),
  securitiesIssuedTotalAmount: Type.Optional(INTEGER_NONNEGATIVE_13),
  securitiesPrincipalHolderAmount: Type.Optional(INTEGER_NONNEGATIVE_13),
  securitiesIssuedAggregateAmount: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  aggregateConsiderationBasis: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
});

const UNREGISTERED_SECURITIES_ACT_TYPE = Type.Object({
  securitiesActExcemption: Type.Optional(STRING_255_TYPE),
});

const HEADER_DATA = Type.Object({
  submissionType: SUBMISSION_TYPE,
  filerInfo: FILER_INFO_TYPE,
  coIssuerInfo: Type.Optional(CO_ISSUER_INFO_TYPE),
});

const FORM_DATA = Type.Object({
  employeesInfo: Type.Array(EMPLOYEES_INFO_TYPE, { minItems: 1, maxItems: 15 }),
  issuerInfo: ISSUER_INFO_TYPE,
  commonEquity: Type.Array(COMMON_EQUITY_TYPE, { minItems: 1, maxItems: 10 }),
  preferredEquity: Type.Array(PREFERRED_EQUITY_TYPE, { minItems: 1, maxItems: 10 }),
  debtSecurities: Type.Array(DEBT_SECURITIES_TYPE, { minItems: 1, maxItems: 10 }),
  issuerEligibility: ISSUER_ELIGIBILITY_TYPE,
  applicationRule262: APPLICATION_RULE262_TYPE,
  summaryInfo: SUMMARY_INFO_TYPE,
  juridictionSecuritiesOffered: Type.Optional(JURIDICTION_SECURITIES_OFFERED_TYPE),
  unregisteredSecurities: Type.Optional(UNREGISTERED_SECURITIES_TYPE),
  securitiesIssued: Type.Optional(Type.Array(SECURITIES_ISSUED_TYPE, { maxItems: 50 })),
  unregisteredSecuritiesAct: Type.Optional(UNREGISTERED_SECURITIES_ACT_TYPE),
});

const EDGAR_DOCUMENTS_TYPE = Type.Object({
  document: Type.Optional(Type.Array(Type.Object({}), { minItems: 0 })),
});

export const Form1ASchema = Type.Object({
  schemaVersion: Type.Optional(SCHEMA_VERSION_TYPE),
  headerData: HEADER_DATA,
  formData: FORM_DATA,
  documents: Type.Optional(EDGAR_DOCUMENTS_TYPE),
});

export type Form1A = Static<typeof Form1ASchema>;

export const Form1ASubmissionSchema = Type.Object({
  edgarSubmission: Form1ASchema,
});

export type Form1ASubmission = Static<typeof Form1ASubmissionSchema>;
