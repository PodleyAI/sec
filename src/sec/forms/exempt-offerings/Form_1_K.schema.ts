//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Type, Static } from "@sinclair/typebox";
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
} from "../FormSchemaUtil";
import { STATE_COUNTRY_CODE } from "../../../storage/address/AddressSchema";

export const SUBMISSION_TYPE = Type.Union([Type.Literal("1-K"), Type.Literal("1-K/A")]);

export const FORM_INDICATION_TYPE = Type.Union([
  Type.Literal("Annual Report"),
  Type.Literal("Special Financial Report for the fiscal year"),
]);

export const YES_NO_TYPE = Type.Union([Type.Literal("Y"), Type.Literal("N")]);

// Common types based on XSD
const CCC_TYPE = Type.String({ minLength: 8, maxLength: 8 });
const FILE_NUMBER_TYPE = Type.String({ minLength: 1, maxLength: 17 });
const FILE_NUMBER_TYPE_2 = Type.String({ minLength: 1, maxLength: 17 });
const DECIMAL_TYPE13_2 = Type.Number();
const DECIMAL_TYPE13_4 = Type.Number();
const INTEGER_NONNEGATIVE_13 = Type.Integer({ minimum: 0, maximum: 9999999999999 });
const INTEGER_TYPE_4 = Type.Integer({ minimum: 1, maximum: 9999 });
const IRS_NUMBER_TYPE = Type.String({ pattern: "^\\d{2}-\\d{7}$" });
const STRING_30_TYPE = Type.String({ minLength: 1, maxLength: 30 });
const CRD_NUMBER_TYPE = Type.String({ maxLength: 9 });
const DATE_TYPE = Type.String({ minLength: 1, maxLength: 20 });

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
  fileNumber: Type.Optional(FILE_NUMBER_TYPE_2),
  successorFileNumber: Type.Optional(FILE_NUMBER_TYPE),
});

const FLAGS_TYPE = Type.Object({
  shellCompanyFlag: YES_NO_TYPE,
  confirmingCopyFlag: Type.Optional(TRUE_FALSE_LIST),
  successorFilingFlag: YES_NO_TYPE,
  returnCopyFlag: Type.Optional(TRUE_FALSE_LIST),
  overrideInternetFlag: Type.Optional(TRUE_FALSE_LIST),
});

const CONTACT_TYPE = Type.Object({
  contactName: Type.Optional(ENTITY_NAME_TYPE),
  contactPhone: Type.Optional(PHONE_NUMBER_TYPE),
  contactEmail: Type.Optional(EMAIL_TYPE),
});

const NOTIFICATIONS_TYPE = Type.Object({
  notificationEmail: Type.Optional(Type.Array(EMAIL_TYPE, { maxItems: 3 })),
});

const CO_FILER_TYPE = Type.Object({
  coIssuerCredentials: Type.Optional(CO_ISSUER_CREDENTIALS_TYPE),
  fileNumber: Type.Optional(FILE_NUMBER_TYPE_2),
});

const FILER_INFO_TYPE = Type.Object({
  liveTestFlag: Type.Union([Type.Literal("LIVE"), Type.Literal("TEST")]),
  filer: FILER_TYPE,
  flags: FLAGS_TYPE,
  reportingPeriod: DATE_TYPE,
  contact: Type.Optional(CONTACT_TYPE),
  notifications: Type.Optional(NOTIFICATIONS_TYPE),
});

const CO_ISSUER_INFO_TYPE = Type.Object({
  "co-filer": Type.Optional(Type.Array(CO_FILER_TYPE, { maxItems: 15 })),
});

const ITEM1_TYPE = Type.Object({
  formIndication: FORM_INDICATION_TYPE,
  fiscalYearEnd: DATE_TYPE,
  street1: STREET_TYPE,
  street2: Type.Optional(STREET_TYPE),
  city: STRING_30_TYPE,
  stateOrCountry: STATE_COUNTRY_CODE,
  zipCode: ZIP_CODE_TYPE,
  phoneNumber: PHONE_NUMBER_TYPE,
  issuedSecuritiesTitle: STRING_255_TYPE,
});

const ITEM1_INFO_TYPE = Type.Object({
  issuerName: Type.Optional(STRING_150_TYPE),
  cik: Type.Optional(CIK_TYPE),
  jurisdictionOrganization: Type.Optional(STATE_COUNTRY_CODE),
  irsNum: Type.Optional(IRS_NUMBER_TYPE),
});

const ITEM_2_TYPE = Type.Object({
  regArule257: Type.Union([Type.Literal("true"), Type.Literal("false")]),
});

const SUMMARY_INFO_TYPE = Type.Object({
  commissionFileNumber: Type.Optional(FILE_NUMBER_TYPE),
  offeringQualificationDate: Type.Optional(DATE_TYPE),
  offeringCommenceDate: Type.Optional(DATE_TYPE),
  qualifiedSecuritiesSold: Type.Optional(INTEGER_NONNEGATIVE_13),
  offeringSecuritiesSold: Type.Optional(INTEGER_NONNEGATIVE_13),
  pricePerSecurity: Type.Optional(DECIMAL_TYPE13_4),
  aggregrateOfferingPrice: Type.Optional(DECIMAL_TYPE13_2),
  aggregrateOfferingPriceHolders: Type.Optional(DECIMAL_TYPE13_2),
  underwrittenSpName: Type.Optional(STRING_150_TYPE),
  underwriterFees: Type.Optional(DECIMAL_TYPE13_2),
  salesCommissionsSpName: Type.Optional(STRING_150_TYPE),
  salesCommissionsFee: Type.Optional(DECIMAL_TYPE13_2),
  findersSpName: Type.Optional(STRING_150_TYPE),
  findersFees: Type.Optional(DECIMAL_TYPE13_2),
  auditorSpName: Type.Optional(STRING_150_TYPE),
  auditorFees: Type.Optional(DECIMAL_TYPE13_2),
  legalSpName: Type.Optional(STRING_150_TYPE),
  legalFees: Type.Optional(DECIMAL_TYPE13_2),
  promoterSpName: Type.Optional(STRING_150_TYPE),
  promotersFees: Type.Optional(DECIMAL_TYPE13_2),
  blueSkySpName: Type.Optional(STRING_150_TYPE),
  blueSkyFees: Type.Optional(DECIMAL_TYPE13_2),
  crdNumberBrokerDealer: Type.Optional(CRD_NUMBER_TYPE),
  issuerNetProceeds: Type.Optional(DECIMAL_TYPE13_2),
  clarificationResponses: Type.Optional(STRING_255_TYPE),
});

const HEADER_DATA = Type.Object({
  submissionType: SUBMISSION_TYPE,
  filerInfo: FILER_INFO_TYPE,
  coIssuerInfo: Type.Optional(CO_ISSUER_INFO_TYPE),
});

const FORM_DATA = Type.Object({
  item1: ITEM1_TYPE,
  item1Info: Type.Array(ITEM1_INFO_TYPE, { maxItems: 15 }),
  item2: ITEM_2_TYPE,
  summaryInfo: Type.Optional(Type.Array(SUMMARY_INFO_TYPE, { maxItems: 5 })),
});

const EDGAR_DOCUMENTS_TYPE = Type.Object({
  document: Type.Optional(Type.Array(Type.Object({}), { minItems: 0 })),
});

export const Form1KSchema = Type.Object({
  schemaVersion: Type.Optional(SCHEMA_VERSION_TYPE),
  headerData: HEADER_DATA,
  formData: FORM_DATA,
  documents: Type.Optional(EDGAR_DOCUMENTS_TYPE),
});

export type Form1K = Static<typeof Form1KSchema>;

export const Form1KSubmissionSchema = Type.Object({
  edgarSubmission: Form1KSchema,
});

export type Form1KSubmission = Static<typeof Form1KSubmissionSchema>;
