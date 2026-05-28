/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Schema for the EDGAR Form 144 (and 144/A) "Notice of Proposed Sale of
// Securities" XML. Since 2022 these are filed electronically under the
// shared edgar/ownership namespace, with a `com:` common namespace for
// address parts. The parser runs with removeNSPrefix, so `com:street1`
// arrives as `street1`.
//
// Unlike the ownership forms (3/4/5), Form 144 leaves are plain text rather
// than `{ value }` wrappers, and dates are US-format strings (MM/DD/YYYY),
// stored verbatim rather than coerced to ISO.

import { Static, Type } from "typebox";

const ADDRESS_TYPE = Type.Object({
  street1: Type.Optional(Type.String()),
  street2: Type.Optional(Type.String()),
  city: Type.Optional(Type.String()),
  stateOrCountry: Type.Optional(Type.String()),
  zipCode: Type.Optional(Type.String()),
});

const FILER_CREDENTIALS_TYPE = Type.Object({
  cik: Type.Optional(Type.String()),
  ccc: Type.Optional(Type.String()),
});

const FILER_INFO_TYPE = Type.Object({
  filer: Type.Optional(
    Type.Object({
      filerCredentials: Type.Optional(FILER_CREDENTIALS_TYPE),
    })
  ),
  liveTestFlag: Type.Optional(Type.String()),
});

const HEADER_DATA_TYPE = Type.Object({
  submissionType: Type.Optional(Type.String()),
  filerInfo: Type.Optional(FILER_INFO_TYPE),
});

const RELATIONSHIPS_TO_ISSUER_TYPE = Type.Object({
  relationshipToIssuer: Type.Optional(Type.Array(Type.String())),
});

const ISSUER_INFO_TYPE = Type.Object({
  issuerCik: Type.Optional(Type.String()),
  issuerName: Type.Optional(Type.String()),
  secFileNumber: Type.Optional(Type.String()),
  issuerAddress: Type.Optional(ADDRESS_TYPE),
  issuerContactPhone: Type.Optional(Type.String()),
  nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold: Type.Optional(Type.String()),
  relationshipsToIssuer: Type.Optional(RELATIONSHIPS_TO_ISSUER_TYPE),
});

const BROKER_DETAILS_TYPE = Type.Object({
  name: Type.Optional(Type.String()),
  address: Type.Optional(ADDRESS_TYPE),
});

const SECURITIES_INFORMATION_TYPE = Type.Object({
  securitiesClassTitle: Type.Optional(Type.String()),
  brokerOrMarketmakerDetails: Type.Optional(BROKER_DETAILS_TYPE),
  // Numeric leaves are kept as raw strings and coerced in storage. Typing them
  // as Type.Number() would let Value.Convert turn an empty element ("") into a
  // fabricated 0, indistinguishable from a real zero.
  noOfUnitsSold: Type.Optional(Type.String()),
  aggregateMarketValue: Type.Optional(Type.String()),
  noOfUnitsOutstanding: Type.Optional(Type.String()),
  approxSaleDate: Type.Optional(Type.String()),
  securitiesExchangeName: Type.Optional(Type.String()),
});

const SECURITIES_TO_BE_SOLD_TYPE = Type.Object({
  securitiesClassTitle: Type.Optional(Type.String()),
  acquiredDate: Type.Optional(Type.String()),
  natureOfAcquisitionTransaction: Type.Optional(Type.String()),
  nameOfPersonfromWhomAcquired: Type.Optional(Type.String()),
  isGiftTransaction: Type.Optional(Type.String()),
  amountOfSecuritiesAcquired: Type.Optional(Type.String()),
  paymentDate: Type.Optional(Type.String()),
  natureOfPayment: Type.Optional(Type.String()),
});

const SELLER_DETAILS_TYPE = Type.Object({
  name: Type.Optional(Type.String()),
  address: Type.Optional(ADDRESS_TYPE),
});

const SECURITIES_SOLD_PAST_3_MONTHS_TYPE = Type.Object({
  sellerDetails: Type.Optional(SELLER_DETAILS_TYPE),
  securitiesClassTitle: Type.Optional(Type.String()),
  saleDate: Type.Optional(Type.String()),
  amountOfSecuritiesSold: Type.Optional(Type.String()),
  grossProceeds: Type.Optional(Type.String()),
});

const NOTICE_SIGNATURE_TYPE = Type.Object({
  noticeDate: Type.Optional(Type.String()),
  signature: Type.Optional(Type.String()),
});

const FORM_DATA_TYPE = Type.Object({
  issuerInfo: Type.Optional(ISSUER_INFO_TYPE),
  securitiesInformation: Type.Optional(SECURITIES_INFORMATION_TYPE),
  securitiesToBeSold: Type.Optional(Type.Array(SECURITIES_TO_BE_SOLD_TYPE)),
  nothingToReportFlagOnSecuritiesSoldInPast3Months: Type.Optional(Type.String()),
  securitiesSoldInPast3Months: Type.Optional(Type.Array(SECURITIES_SOLD_PAST_3_MONTHS_TYPE)),
  noticeSignature: Type.Optional(NOTICE_SIGNATURE_TYPE),
});

export const Form144Schema = Type.Object({
  headerData: Type.Optional(HEADER_DATA_TYPE),
  formData: Type.Optional(FORM_DATA_TYPE),
});

export type Form144 = Static<typeof Form144Schema>;

// Wrapper matching the XML root element so the parser's array-path detection
// produces `edgarSubmission.*` jpaths.
export const Form144SubmissionSchema = Type.Object({
  edgarSubmission: Form144Schema,
});

export type Form144Submission = Static<typeof Form144SubmissionSchema>;
