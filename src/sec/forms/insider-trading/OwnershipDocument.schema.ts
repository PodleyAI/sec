/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared schema for the EDGAR "ownershipDocument" used by Section 16 Forms
// 3, 4, and 5 (and their /A amendments). Form 3 reports initial holdings,
// Form 4 reports transactions, Form 5 is the annual statement (holdings +
// late transactions). All three share this single namespace.
//
// EDGAR wraps most leaf values as `<field><value>X</value></field>` with an
// optional sibling `<footnoteId id="Fn"/>`. Attributes are dropped by the
// parser (ignoreAttributes), so footnote ids are not modeled. Numeric and
// boolean-ish fields are coerced leniently in storage via the unwrap helpers
// because empty elements (e.g. `<deemedExecutionDate/>`) parse to "".

import { Static, Type } from "typebox";

// A `{ value }` wrapper around a string-bearing leaf.
const VALUE_STRING = Type.Object({
  value: Type.Optional(Type.String()),
});

// A `{ value }` wrapper around a numeric leaf. Convert coerces "10000" -> 10000.
const VALUE_NUMBER = Type.Object({
  value: Type.Optional(Type.Number()),
});

const ISSUER_TYPE = Type.Object({
  issuerCik: Type.Optional(Type.String()),
  issuerName: Type.Optional(Type.String()),
  issuerTradingSymbol: Type.Optional(Type.String()),
  issuerForeignTradingSymbol: Type.Optional(Type.String()),
});

const REPORTING_OWNER_ID_TYPE = Type.Object({
  rptOwnerCik: Type.Optional(Type.String()),
  rptOwnerCcc: Type.Optional(Type.String()),
  rptOwnerName: Type.Optional(Type.String()),
});

const REPORTING_OWNER_ADDRESS_TYPE = Type.Object({
  rptOwnerNonUSAddressFlag: Type.Optional(Type.String()),
  rptOwnerStreet1: Type.Optional(Type.String()),
  rptOwnerStreet2: Type.Optional(Type.String()),
  rptOwnerCity: Type.Optional(Type.String()),
  rptOwnerState: Type.Optional(Type.String()),
  rptOwnerZipCode: Type.Optional(Type.String()),
  rptOwnerStateDescription: Type.Optional(Type.String()),
  rptOwnerNonUSStateTerritory: Type.Optional(Type.String()),
  rptOwnerCountry: Type.Optional(Type.String()),
});

const REPORTING_OWNER_RELATIONSHIP_TYPE = Type.Object({
  isDirector: Type.Optional(Type.String()),
  isOfficer: Type.Optional(Type.String()),
  isTenPercentOwner: Type.Optional(Type.String()),
  isOther: Type.Optional(Type.String()),
  officerTitle: Type.Optional(Type.String()),
  otherText: Type.Optional(Type.String()),
});

const REPORTING_OWNER_TYPE = Type.Object({
  reportingOwnerId: Type.Optional(REPORTING_OWNER_ID_TYPE),
  reportingOwnerAddress: Type.Optional(REPORTING_OWNER_ADDRESS_TYPE),
  reportingOwnerRelationship: Type.Optional(REPORTING_OWNER_RELATIONSHIP_TYPE),
});

const TRANSACTION_CODING_TYPE = Type.Object({
  transactionFormType: Type.Optional(Type.String()),
  transactionCode: Type.Optional(Type.String()),
  equitySwapInvolved: Type.Optional(Type.String()),
});

const TRANSACTION_AMOUNTS_TYPE = Type.Object({
  transactionShares: Type.Optional(VALUE_NUMBER),
  transactionPricePerShare: Type.Optional(VALUE_NUMBER),
  transactionAcquiredDisposedCode: Type.Optional(VALUE_STRING),
});

const POST_TRANSACTION_AMOUNTS_TYPE = Type.Object({
  sharesOwnedFollowingTransaction: Type.Optional(VALUE_NUMBER),
  valueOwnedFollowingTransaction: Type.Optional(VALUE_NUMBER),
});

const OWNERSHIP_NATURE_TYPE = Type.Object({
  directOrIndirectOwnership: Type.Optional(VALUE_STRING),
  natureOfOwnership: Type.Optional(VALUE_STRING),
});

const UNDERLYING_SECURITY_TYPE = Type.Object({
  underlyingSecurityTitle: Type.Optional(VALUE_STRING),
  underlyingSecurityShares: Type.Optional(VALUE_NUMBER),
  underlyingSecurityValue: Type.Optional(VALUE_NUMBER),
});

const NON_DERIVATIVE_TRANSACTION_TYPE = Type.Object({
  securityTitle: Type.Optional(VALUE_STRING),
  transactionDate: Type.Optional(VALUE_STRING),
  deemedExecutionDate: Type.Optional(VALUE_STRING),
  transactionCoding: Type.Optional(TRANSACTION_CODING_TYPE),
  transactionAmounts: Type.Optional(TRANSACTION_AMOUNTS_TYPE),
  postTransactionAmounts: Type.Optional(POST_TRANSACTION_AMOUNTS_TYPE),
  ownershipNature: Type.Optional(OWNERSHIP_NATURE_TYPE),
});

const NON_DERIVATIVE_HOLDING_TYPE = Type.Object({
  securityTitle: Type.Optional(VALUE_STRING),
  postTransactionAmounts: Type.Optional(POST_TRANSACTION_AMOUNTS_TYPE),
  ownershipNature: Type.Optional(OWNERSHIP_NATURE_TYPE),
});

const NON_DERIVATIVE_TABLE_TYPE = Type.Object({
  nonDerivativeTransaction: Type.Optional(Type.Array(NON_DERIVATIVE_TRANSACTION_TYPE)),
  nonDerivativeHolding: Type.Optional(Type.Array(NON_DERIVATIVE_HOLDING_TYPE)),
});

const DERIVATIVE_TRANSACTION_TYPE = Type.Object({
  securityTitle: Type.Optional(VALUE_STRING),
  conversionOrExercisePrice: Type.Optional(VALUE_NUMBER),
  transactionDate: Type.Optional(VALUE_STRING),
  deemedExecutionDate: Type.Optional(VALUE_STRING),
  transactionCoding: Type.Optional(TRANSACTION_CODING_TYPE),
  transactionAmounts: Type.Optional(TRANSACTION_AMOUNTS_TYPE),
  exerciseDate: Type.Optional(VALUE_STRING),
  expirationDate: Type.Optional(VALUE_STRING),
  underlyingSecurity: Type.Optional(UNDERLYING_SECURITY_TYPE),
  postTransactionAmounts: Type.Optional(POST_TRANSACTION_AMOUNTS_TYPE),
  ownershipNature: Type.Optional(OWNERSHIP_NATURE_TYPE),
});

const DERIVATIVE_HOLDING_TYPE = Type.Object({
  securityTitle: Type.Optional(VALUE_STRING),
  conversionOrExercisePrice: Type.Optional(VALUE_NUMBER),
  exerciseDate: Type.Optional(VALUE_STRING),
  expirationDate: Type.Optional(VALUE_STRING),
  underlyingSecurity: Type.Optional(UNDERLYING_SECURITY_TYPE),
  postTransactionAmounts: Type.Optional(POST_TRANSACTION_AMOUNTS_TYPE),
  ownershipNature: Type.Optional(OWNERSHIP_NATURE_TYPE),
});

const DERIVATIVE_TABLE_TYPE = Type.Object({
  derivativeTransaction: Type.Optional(Type.Array(DERIVATIVE_TRANSACTION_TYPE)),
  derivativeHolding: Type.Optional(Type.Array(DERIVATIVE_HOLDING_TYPE)),
});

const FOOTNOTE_TYPE = Type.Object({
  // `id` is an XML attribute (dropped by the parser); only the text remains.
  "#text": Type.Optional(Type.String()),
});

const FOOTNOTES_TYPE = Type.Object({
  footnote: Type.Optional(Type.Array(FOOTNOTE_TYPE)),
});

const OWNER_SIGNATURE_TYPE = Type.Object({
  signatureName: Type.Optional(Type.String()),
  signatureDate: Type.Optional(Type.String()),
});

export const OwnershipDocumentSchema = Type.Object({
  schemaVersion: Type.Optional(Type.String()),
  documentType: Type.Optional(Type.String()),
  periodOfReport: Type.Optional(Type.String()),
  notSubjectToSection16: Type.Optional(Type.String()),
  noSecuritiesOwned: Type.Optional(Type.String()),
  form3HoldingsReported: Type.Optional(Type.String()),
  form4TransactionsReported: Type.Optional(Type.String()),
  aff10b5One: Type.Optional(Type.String()),
  issuer: Type.Optional(ISSUER_TYPE),
  reportingOwner: Type.Optional(Type.Array(REPORTING_OWNER_TYPE)),
  nonDerivativeTable: Type.Optional(NON_DERIVATIVE_TABLE_TYPE),
  derivativeTable: Type.Optional(DERIVATIVE_TABLE_TYPE),
  footnotes: Type.Optional(FOOTNOTES_TYPE),
  remarks: Type.Optional(Type.String()),
  ownerSignature: Type.Optional(Type.Array(OWNER_SIGNATURE_TYPE)),
});

export type OwnershipDocument = Static<typeof OwnershipDocumentSchema>;

// Wrapper matching the XML root element, so the parser's array-path
// detection produces `ownershipDocument.*` jpaths.
export const OwnershipDocumentSubmissionSchema = Type.Object({
  ownershipDocument: OwnershipDocumentSchema,
});

export type OwnershipDocumentSubmission = Static<typeof OwnershipDocumentSubmissionSchema>;
