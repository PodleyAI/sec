/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { Format } from "typebox/format";
import { ArrayToObject } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";
import { TypeSecCik } from "../../util/TypeSecCik";
import { ALL_FORM_NAMES } from "../forms/all-forms";

export { TypeSecCik } from "../../util/TypeSecCik";

// const TypeSECForm = () => Type.Union(ALL_FORM_NAMES.map((f) => Type.Literal(f)));

Format.Set("sec-form", (value: string) => {
  if (!ALL_FORM_NAMES.includes(value as any)) console.warn(`Unknown SEC form: ${value}`);
  return true;
});
export const TypeSECForm = (annotations: Record<string, unknown> = {}) =>
  Type.String({ format: "sec-form", maxLength: 20, ...annotations });
/**
 * EDGAR spells booleans several ways depending on the endpoint: the submissions
 * JSON uses the integers `0`/`1`, ownership XML uses the strings `"0"`/`"1"`,
 * and a few payloads use real JSON booleans. The pipeline parses wire payloads
 * through `Value.Encode`, so the Encode side is what has to absorb all three —
 * it previously tested `value === "1"` only, which is false for the integer `1`
 * that `submissions/CIK*.json` actually sends, silently flattening every
 * `isXBRL`/`isInlineXBRL` in the corpus to `false` (and thence to NULL).
 */
export const secBooleanFromWire = (value: unknown): boolean =>
  value === true || value === 1 || value === "1" || value === "true" || value === "Y";

export const TypeSECBoolean = (annotations: Record<string, unknown> = {}) =>
  Type.Codec(Type.Boolean(annotations))
    .Decode((value) => (value ? "1" : "0"))
    .Encode((value: unknown) => secBooleanFromWire(value));
export const TypeAddress = (annotations: Record<string, unknown> = {}) =>
  Type.Object(
    {
      street1: TypeNullable(Type.String()),
      street2: TypeNullable(Type.String()),
      city: TypeNullable(Type.String()),
      stateOrCountry: TypeNullable(Type.String()),
      zipCode: TypeNullable(Type.String()),
      stateOrCountryDescription: TypeNullable(Type.String()),
      isForeignLocation: Type.Optional(TypeNullable(TypeSECBoolean())),
      foreignStateTerritory: Type.Optional(TypeNullable(Type.String())),
      country: Type.Optional(TypeNullable(Type.String())),
      countryCode: Type.Optional(TypeNullable(Type.String())),
    },
    annotations
  );

export type Address = Static<ReturnType<typeof TypeAddress>>;

export const TypeFilings = () =>
  Type.Object({
    accessionNumber: Type.Array(Type.String({ maxLength: 20 })),
    filingDate: Type.Array(Type.String()),
    reportDate: Type.Array(Type.String()),
    acceptanceDateTime: Type.Array(Type.String()),
    act: Type.Array(Type.String()),
    form: Type.Array(TypeSECForm()),
    filmNumber: Type.Array(Type.String()), // can be list of film numbers separated by commas
    fileNumber: Type.Array(Type.String()), // can be list of file numbers separated by commas
    items: Type.Array(Type.String()),
    size: Type.Array(Type.Number()),
    isXBRL: Type.Array(TypeSECBoolean()),
    isInlineXBRL: Type.Array(TypeSECBoolean()),
    // Optional: EDGAR added this after `isXBRL`, and cached payloads predating
    // it must still validate. Absent means "unknown", not "no numeric facts".
    isXBRLNumeric: Type.Optional(Type.Array(TypeSECBoolean())),
    primaryDocument: Type.Array(Type.String()),
    primaryDocDescription: Type.Array(Type.String()),
  });

export type Filings = Static<ReturnType<typeof TypeFilings>>;
export type Filing = ArrayToObject<Filings>;

export const CompanySubmissionSchema = () =>
  Type.Object({
    cik: TypeSecCik(),
    entityType: Type.String(),
    sic: Type.String(),
    sicDescription: Type.String(),
    insiderTransactionForOwnerExists: TypeSECBoolean(),
    insiderTransactionForIssuerExists: TypeSECBoolean(),
    name: Type.String(),
    tickers: TypeNullable(Type.Array(TypeNullable(Type.String()))),
    exchanges: TypeNullable(Type.Array(TypeNullable(Type.String()))),
    ein: TypeNullable(Type.String()),
    description: Type.String(),
    website: Type.String(),
    investorWebsite: Type.String(),
    category: Type.String(),
    fiscalYearEnd: TypeNullable(Type.String()),
    stateOfIncorporation: Type.String(),
    stateOfIncorporationDescription: Type.String(),
    addresses: Type.Object({
      mailing: TypeAddress(),
      business: TypeAddress(),
    }),
    phone: TypeNullable(Type.String()),
    flags: Type.String(),
    formerNames: Type.Array(
      Type.Object({
        name: Type.String(),
        from: Type.String(),
        to: Type.String(),
      })
    ),
  });

export type CompanySubmission = Static<ReturnType<typeof CompanySubmissionSchema>>;

export const FullCompanySubmissionSchema = () =>
  Type.Object({
    ...CompanySubmissionSchema().properties,
    filings: Type.Object({
      recent: TypeFilings(),
      files: Type.Array(
        Type.Object({
          name: Type.String(),
          filingCount: Type.Number(),
          filingFrom: Type.String(),
          filingTo: Type.String(),
        })
      ),
    }),
  });

export type FullCompanySubmission = Static<ReturnType<typeof FullCompanySubmissionSchema>>;
