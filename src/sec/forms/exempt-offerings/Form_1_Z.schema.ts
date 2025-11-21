//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Static, Type } from "typebox";
import { STATE_COUNTRY_CODE } from "../../../storage/address/AddressSchema";
import {
  CIK_TYPE,
  EMAIL_TYPE,
  ENTITY_NAME_TYPE,
  PHONE_NUMBER_TYPE,
  SCHEMA_VERSION_TYPE,
  STREET_TYPE,
  STRING_150_TYPE,
  STRING_255_TYPE,
  TRUE_FALSE_LIST,
  ZIP_CODE_TYPE,
} from "../FormSchemaUtil";

export const SUBMISSION_TYPE = Type.Union([Type.Literal("1-Z"), Type.Literal("1-Z/A")]);

export const YES_NO_TYPE = Type.Union([Type.Literal("Y"), Type.Literal("N")]);

// Common types based on XSD
const CCC_TYPE = Type.String({ minLength: 8, maxLength: 8 });
const FILE_NUMBER_TYPE = Type.String({ minLength: 1, maxLength: 17 });
const FILE_NUMBER_TYPE_2 = Type.String({ minLength: 1, maxLength: 17 });
const DECIMAL_TYPE13_2 = Type.Number();
const DECIMAL_TYPE14_4 = Type.Number();
const INTEGER_NONNEGATIVE_13 = Type.Integer({ minimum: 0, maximum: 9999999999999 });
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
  fileNumber: Type.Optional(FILE_NUMBER_TYPE),
  successorFileNumber: Type.Optional(FILE_NUMBER_TYPE),
});

const FLAGS_TYPE = Type.Object({
  confirmingCopyFlag: Type.Optional(TRUE_FALSE_LIST),
  successorFilingFlag: YES_NO_TYPE,
  returnCopyFlag: Type.Optional(TRUE_FALSE_LIST),
  overrideInternetFlag: Type.Optional(TRUE_FALSE_LIST),
});

const CONTACT_TYPE = Type.Object({
  contactName: Type.Optional(ENTITY_NAME_TYPE),
  contactPhone: Type.Optional(PHONE_NUMBER_TYPE),
  contactEmailAddress: Type.Optional(EMAIL_TYPE),
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
  contact: Type.Optional(CONTACT_TYPE),
  notifications: Type.Optional(NOTIFICATIONS_TYPE),
});

const CO_ISSUER_INFO_TYPE = Type.Object({
  "co-filer": Type.Optional(Type.Array(CO_FILER_TYPE, { maxItems: 15 })),
});

const ITEM1_TYPE = Type.Object({
  issuerName: STRING_150_TYPE,
  street1: STREET_TYPE,
  street2: Type.Optional(STREET_TYPE),
  city: STRING_30_TYPE,
  stateOrCountry: STATE_COUNTRY_CODE,
  zipCode: ZIP_CODE_TYPE,
  phone: PHONE_NUMBER_TYPE,
  commissionFileNumber: Type.Array(FILE_NUMBER_TYPE, { maxItems: 5 }),
});

const SUMMARY_INFO_OFFERING_TYPE = Type.Object({
  offeringQualificationDate: Type.Optional(DATE_TYPE),
  offeringCommenceDate: Type.Optional(DATE_TYPE),
  offeringSecuritiesQualifiedSold: Type.Optional(INTEGER_NONNEGATIVE_13),
  offeringSecuritiesSold: Type.Optional(INTEGER_NONNEGATIVE_13),
  pricePerSecurity: Type.Optional(DECIMAL_TYPE14_4),
  portionSecuritiesSoldIssuer: Type.Optional(DECIMAL_TYPE13_2),
  portionSecuritiesSoldSecurityholders: Type.Optional(DECIMAL_TYPE13_2),
  underwrittenSpName: Type.Optional(Type.Array(STRING_150_TYPE, { maxItems: 100 })),
  underwriterFees: Type.Optional(DECIMAL_TYPE13_2),
  salesCommissionsSpName: Type.Optional(Type.Array(STRING_150_TYPE, { maxItems: 100 })),
  salesCommissionsFee: Type.Optional(DECIMAL_TYPE13_2),
  findersSpName: Type.Optional(Type.Array(STRING_150_TYPE, { maxItems: 100 })),
  findersFees: Type.Optional(DECIMAL_TYPE13_2),
  auditorSpName: Type.Optional(Type.Array(STRING_150_TYPE, { maxItems: 100 })),
  auditorFees: Type.Optional(DECIMAL_TYPE13_2),
  legalSpName: Type.Optional(Type.Array(STRING_150_TYPE, { maxItems: 100 })),
  legalFees: Type.Optional(DECIMAL_TYPE13_2),
  promoterSpName: Type.Optional(Type.Array(STRING_150_TYPE, { maxItems: 100 })),
  promotersFees: Type.Optional(DECIMAL_TYPE13_2),
  blueSkySpName: Type.Optional(Type.Array(STRING_150_TYPE, { maxItems: 100 })),
  blueSkyFees: Type.Optional(DECIMAL_TYPE13_2),
  crdNumberBrokerDealer: Type.Optional(CRD_NUMBER_TYPE),
  issuerNetProceeds: Type.Optional(DECIMAL_TYPE13_2),
  clarificationResponses: Type.Optional(STRING_255_TYPE),
});

const CERTIFICATION_SUSPENSION_TYPE = Type.Object({
  securitiesClassTitle: Type.Optional(STRING_255_TYPE),
  certificationFileNumber: Type.Array(FILE_NUMBER_TYPE, { maxItems: 5 }),
  approxRecordHolders: Type.Optional(INTEGER_NONNEGATIVE_13),
});

const SIGNATURE_TAB_TYPE = Type.Object({
  cik: CIK_TYPE,
  regulationIssuerName1: STRING_150_TYPE,
  regulationIssuerName2: STRING_150_TYPE,
  signatureBy: STRING_150_TYPE,
  date: DATE_TYPE,
  title: STRING_255_TYPE,
});

const HEADER_DATA = Type.Object({
  submissionType: SUBMISSION_TYPE,
  filerInfo: FILER_INFO_TYPE,
  coIssuerInfo: Type.Optional(CO_ISSUER_INFO_TYPE),
});

const FORM_DATA = Type.Object({
  item1: ITEM1_TYPE,
  summaryInfoOffering: Type.Optional(Type.Array(SUMMARY_INFO_OFFERING_TYPE, { maxItems: 5 })),
  certificationSuspension: Type.Optional(
    Type.Array(CERTIFICATION_SUSPENSION_TYPE, { maxItems: 100 })
  ),
  signatureTab: Type.Array(SIGNATURE_TAB_TYPE, { maxItems: 16 }),
});

export const Form1ZSchema = Type.Object({
  schemaVersion: Type.Optional(SCHEMA_VERSION_TYPE),
  headerData: HEADER_DATA,
  formData: FORM_DATA,
});

export type Form1Z = Static<typeof Form1ZSchema>;

export const Form1ZSubmissionSchema = Type.Object({
  edgarSubmission: Form1ZSchema,
});

export type Form1ZSubmission = Static<typeof Form1ZSubmissionSchema>;
