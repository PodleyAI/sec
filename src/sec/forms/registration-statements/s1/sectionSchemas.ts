/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "workglow";

const NULLABLE_STRING = { type: ["string", "null"] } as const;
const NULLABLE_NUMBER = { type: ["number", "null"] } as const;

/** Common provenance fields every extracted row carries. */
const CONFIDENCE = { type: "number", minimum: 0, maximum: 1 } as const;
const SOURCE_SPAN = { type: "string" } as const;

/**
 * The per-call verification token the model must echo back into `nonce_seen`.
 * The pattern (16 lowercase hex) matches what {@link buildUntrustedPreamble}
 * plants; `StructuredGenerationTask`'s schema-retry loop catches a malformed
 * echo before it reaches {@link verifyNonce} and dead-letters as
 * `NONCE_MISMATCH`.
 */
const NONCE_SEEN = { type: "string", pattern: "^[0-9a-f]{16}$" } as const;

export const ManagementOutputSchema = {
  type: "object",
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        properties: {
          full_name: { type: "string" },
          titles: {
            type: "array",
            items: { type: "string" },
            description:
              "The person's distinct roles as separate entries — split a compound " +
              "title like 'CEO and Director' into ['Chief Executive Officer', 'Director']",
          },
          relationship: NULLABLE_STRING,
          age: NULLABLE_NUMBER,
          bio: NULLABLE_STRING,
          confidence: CONFIDENCE,
          source_span: SOURCE_SPAN,
        },
        required: ["full_name", "titles", "confidence", "source_span"],
        additionalProperties: false,
      },
    },
    nonce_seen: NONCE_SEEN,
  },
  required: ["people", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const BeneficialOwnershipOutputSchema = {
  type: "object",
  properties: {
    owners: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          owner_kind: { type: "string", enum: ["person", "company"] },
          security_class: NULLABLE_STRING,
          shares_owned: NULLABLE_NUMBER,
          percent_owned: NULLABLE_NUMBER,
          shares_offered: NULLABLE_NUMBER,
          shares_after: NULLABLE_NUMBER,
          percent_after: NULLABLE_NUMBER,
          is_selling_stockholder: { type: "boolean" },
          footnote: NULLABLE_STRING,
          confidence: CONFIDENCE,
          source_span: SOURCE_SPAN,
        },
        required: ["name", "owner_kind", "is_selling_stockholder", "confidence", "source_span"],
        additionalProperties: false,
      },
    },
    nonce_seen: NONCE_SEEN,
  },
  required: ["owners", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const RelatedPartyOutputSchema = {
  type: "object",
  properties: {
    parties: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          party_kind: { type: "string", enum: ["person", "company"] },
          confidence: CONFIDENCE,
          source_span: SOURCE_SPAN,
          transactions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                counterparty: NULLABLE_STRING,
                nature: NULLABLE_STRING,
                amount: NULLABLE_NUMBER,
                period: NULLABLE_STRING,
                footnote: NULLABLE_STRING,
              },
              required: [],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "party_kind", "confidence", "source_span", "transactions"],
        additionalProperties: false,
      },
    },
    nonce_seen: NONCE_SEEN,
  },
  required: ["parties", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

// Row types inferred for use by extractors / mapper.
export interface ManagementPersonRow {
  full_name: string;
  titles: string[];
  relationship: string | null;
  age: number | null;
  bio: string | null;
  confidence: number;
  source_span: string;
}
export interface BeneficialOwnerRow {
  name: string;
  owner_kind: "person" | "company";
  security_class: string | null;
  shares_owned: number | null;
  percent_owned: number | null;
  shares_offered: number | null;
  shares_after: number | null;
  percent_after: number | null;
  is_selling_stockholder: boolean;
  footnote: string | null;
  confidence: number;
  source_span: string;
  /** Persist-only; never part of the model JSON schema. */
  source?: "deterministic";
}
export interface RelatedPartyRow {
  name: string;
  party_kind: "person" | "company";
  confidence: number;
  source_span: string;
  transactions: ReadonlyArray<{
    counterparty: string | null;
    nature: string | null;
    amount: number | null;
    period: string | null;
    footnote: string | null;
  }>;
}
