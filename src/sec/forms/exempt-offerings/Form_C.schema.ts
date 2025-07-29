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

export const SUBMISSION_TYPE = Type.Union([
  Type.Literal("C"),
  Type.Literal("C-W"),
  Type.Literal("C-U"),
  Type.Literal("C-U-W"),
  Type.Literal("C/A"),
  Type.Literal("C/A-W"),
  Type.Literal("C-AR"),
  Type.Literal("C-AR-W"),
  Type.Literal("C-AR/A"),
  Type.Literal("C-AR/A-W"),
  Type.Literal("C-TR"),
  Type.Literal("C-TR-W"),
]);

export const LEGAL_STATUS_FORM_TYPE = Type.Union([
  Type.Literal("Corporation"),
  Type.Literal("Limited Partnership"),
  Type.Literal("Limited Liability Company"),
  Type.Literal("General Partnership"),
  Type.Literal("Business Trust"),
  Type.Literal("Other"),
]);

export const SECURITY_OFFERED_TYPE = Type.Union([
  Type.Literal("Common Stock"),
  Type.Literal("Preferred Stock"),
  Type.Literal("Debt"),
  Type.Literal("Other"),
]);

export const OVER_SUBSCRIPTION_ALLOCATION_TYPE = Type.Union([
  Type.Literal("Pro-rata basis"),
  Type.Literal("First-come, first-served basis"),
  Type.Literal("Other"),
]);

export const YES_NO_TYPE = Type.Union([Type.Literal("Y"), Type.Literal("N")]);

const CCC_TYPE = Type.String({ minLength: 8, maxLength: 8 });
const FILE_NUMBER_TYPE = Type.String({ minLength: 1, maxLength: 17 });
const DECIMAL_TYPE7_5_FIXED = Type.Number();
const DECIMAL_TYPE7_2_FIXED = Type.Number();
const DECIMAL_TYPE14_2_FIXED = Type.Number();
const INTEGER_TYPE_10 = Type.Integer({ minimum: 1, maximum: 9999999999 });
const DECIMAL_TYPE7_2_NONNEGATIVE = Type.Number({ minimum: 0 });
const DATE_TYPE = Type.String({ format: "date" });
const CRD_NUMBER_TYPE = Type.String({ maxLength: 9 });

const FILER_CREDENTIALS_TYPE = Type.Object({
  filerCik: CIK_TYPE,
  filerCcc: CCC_TYPE,
});

const LEGAL_STATUS_TYPE = Type.Object({
  legalStatusForm: Type.Optional(LEGAL_STATUS_FORM_TYPE),
  legalStatusOtherDesc: Type.Optional(STRING_255_TYPE),
  jurisdictionOrganization: Type.Optional(STATE_COUNTRY_CODE),
  dateIncorporation: Type.Optional(DATE_TYPE),
});

const FILER_TYPE = Type.Object({
  filerCredentials: FILER_CREDENTIALS_TYPE,
  fileNumber: Type.Optional(FILE_NUMBER_TYPE),
});

const FLAGS_TYPE = Type.Object({
  confirmingCopyFlag: Type.Optional(TRUE_FALSE_LIST),
  returnCopyFlag: Type.Optional(TRUE_FALSE_LIST),
  overrideInternetFlag: Type.Optional(TRUE_FALSE_LIST),
});

const CONTACT_TYPE = Type.Object({
  contactName: ENTITY_NAME_TYPE,
  contactPhone: PHONE_NUMBER_TYPE,
  contactEmail: EMAIL_TYPE,
});

const NOTIFICATIONS_TYPE = Type.Object({
  notificationEmail: Type.Optional(Type.Array(EMAIL_TYPE, { maxItems: 3 })),
});

const ADDRESS_TYPE = Type.Object({
  street1: STREET_TYPE,
  street2: Type.Optional(STREET_TYPE),
  city: CITY_TYPE,
  stateOrCountry: STATE_COUNTRY_CODE,
  zipCode: ZIP_CODE_TYPE,
});

const ISSUER_INFO_TYPE = Type.Object({
  nameOfIssuer: STRING_150_TYPE,
  legalStatus: Type.Optional(LEGAL_STATUS_TYPE),
  issuerAddress: Type.Optional(ADDRESS_TYPE),
  issuerWebsite: Type.Optional(STRING_255_TYPE),
});

const CO_ISSUER_INFO_TYPE = Type.Object({
  isEdgarFiler: Type.Optional(Type.Literal("EdgarFiler")),
  coIssuerCik: Type.Optional(CIK_TYPE),
  nameOfCoIssuer: Type.Optional(STRING_150_TYPE),
  coIssuerLegalStatus: Type.Optional(LEGAL_STATUS_TYPE),
  coIssuerAddress: Type.Optional(ADDRESS_TYPE),
  coIssuerWebsite: Type.Optional(STRING_255_TYPE),
});

const CO_ISSUERS_INFO_TYPE = Type.Object({
  coIssuerInfo: Type.Optional(Type.Array(CO_ISSUER_INFO_TYPE, { maxItems: 50 })),
});

const ISSUER_INFORMATION_TYPE = Type.Object({
  isAmendment: Type.Optional(TRUE_FALSE_LIST),
  progressUpdate: Type.Optional(STRING_255_TYPE),
  natureOfAmendment: Type.Optional(STRING_255_TYPE),
  issuerInfo: ISSUER_INFO_TYPE,
  isCoIssuer: Type.Optional(YES_NO_TYPE),
  coIssuers: Type.Optional(CO_ISSUERS_INFO_TYPE),
  companyName: Type.Optional(STRING_150_TYPE),
  commissionCik: Type.Optional(CIK_TYPE),
  commissionFileNumber: Type.Optional(FILE_NUMBER_TYPE),
  crdNumber: Type.Optional(CRD_NUMBER_TYPE),
});

const OFFERING_INFORMATION_TYPE = Type.Object({
  compensationAmount: Type.Optional(STRING_255_TYPE),
  financialInterest: Type.Optional(STRING_255_TYPE),
  securityOfferedType: Type.Optional(SECURITY_OFFERED_TYPE),
  securityOfferedOtherDesc: Type.Optional(STRING_255_TYPE),
  noOfSecurityOffered: Type.Optional(INTEGER_TYPE_10),
  price: Type.Optional(DECIMAL_TYPE7_5_FIXED),
  priceDeterminationMethod: Type.Optional(STRING_255_TYPE),
  offeringAmount: Type.Optional(DECIMAL_TYPE7_2_FIXED),
  overSubscriptionAccepted: Type.Optional(YES_NO_TYPE),
  overSubscriptionAllocationType: Type.Optional(OVER_SUBSCRIPTION_ALLOCATION_TYPE),
  descOverSubscription: Type.Optional(STRING_255_TYPE),
  maximumOfferingAmount: Type.Optional(DECIMAL_TYPE7_2_FIXED),
  deadlineDate: Type.Optional(DATE_TYPE),
});

const ANNUAL_REPORT_DISCLOSURE_REQUIREMENTS_TYPE = Type.Object({
  currentEmployees: Type.Optional(DECIMAL_TYPE7_2_NONNEGATIVE),
  totalAssetMostRecentFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  totalAssetPriorFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  cashEquiMostRecentFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  cashEquiPriorFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  actReceivedMostRecentFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  actReceivedPriorFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  shortTermDebtMostRecentFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  shortTermDebtPriorFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  longTermDebtMostRecentFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  longTermDebtPriorFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  revenueMostRecentFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  revenuePriorFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  costGoodsSoldMostRecentFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  costGoodsSoldPriorFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  taxPaidMostRecentFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  taxPaidPriorFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  netIncomeMostRecentFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  netIncomePriorFiscalYear: Type.Optional(DECIMAL_TYPE14_2_FIXED),
  issueJurisdictionSecuritiesOffering: Type.Optional(
    Type.Array(STATE_COUNTRY_CODE, { maxItems: 64 })
  ),
});

const ISSUER_SIGNATURE_TYPE = Type.Object({
  issuer: STRING_150_TYPE,
  issuerSignature: STRING_150_TYPE,
  issuerTitle: STRING_255_TYPE,
});

const SIGNATURE_PERSON_TYPE = Type.Object({
  personSignature: STRING_150_TYPE,
  personTitle: STRING_255_TYPE,
  signatureDate: DATE_TYPE,
});

const SIGNATURE_PERSONS_TYPE = Type.Object({
  signaturePerson: Type.Array(SIGNATURE_PERSON_TYPE, { maxItems: 15 }),
});

const SIGNATURE_INFO_TYPE = Type.Object({
  issuerSignature: ISSUER_SIGNATURE_TYPE,
  signaturePersons: SIGNATURE_PERSONS_TYPE,
});

const FILER_INFO_TYPE = Type.Object({
  filer: FILER_TYPE,
  period: Type.Optional(DATE_TYPE),
  liveTestFlag: Type.Union([Type.Literal("LIVE"), Type.Literal("TEST")]),
  flags: FLAGS_TYPE,
  contact: Type.Optional(CONTACT_TYPE),
  notifications: Type.Optional(NOTIFICATIONS_TYPE),
});

const HEADER_DATA = Type.Object({
  submissionType: SUBMISSION_TYPE,
  filerInfo: FILER_INFO_TYPE,
});

const FORM_DATA = Type.Object({
  issuerInformation: ISSUER_INFORMATION_TYPE,
  offeringInformation: Type.Optional(OFFERING_INFORMATION_TYPE),
  annualReportDisclosureRequirements: Type.Optional(ANNUAL_REPORT_DISCLOSURE_REQUIREMENTS_TYPE),
  signatureInfo: SIGNATURE_INFO_TYPE,
});

const EDGAR_DOCUMENTS_TYPE = Type.Object({
  // Simplified for now - would need to be expanded based on actual document structure
  document: Type.Optional(Type.Array(Type.Object({}), { minItems: 0 })),
});

export const FormCSchema = Type.Object({
  schemaVersion: Type.Optional(SCHEMA_VERSION_TYPE),
  headerData: HEADER_DATA,
  formData: FORM_DATA,
  documents: Type.Optional(EDGAR_DOCUMENTS_TYPE),
});

export type FormC = Static<typeof FormCSchema>;

export const FormCSubmissionSchema = Type.Object({
  edgarSubmission: FormCSchema,
});

export type FormCSubmission = Static<typeof FormCSubmissionSchema>;
