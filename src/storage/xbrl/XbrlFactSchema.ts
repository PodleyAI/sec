/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * One XBRL fact extracted from a filing (inline iXBRL or instance XML), with
 * its context's period and dimensions denormalized onto the row so concept
 * queries don't need a context join.
 */
export const XbrlFactRowSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  fact_index: Type.Integer(),
  cik: TypeNullable(TypeSecCik()),
  concept: Type.String({ maxLength: 256 }),
  namespace: TypeNullable(Type.String({ maxLength: 256 })),
  // iXBRL context ids are auto-generated and can be long (dimensional contexts
  // concatenate axis/member segments); 128 overflowed on real filings. Not part
  // of the PK and only denormalized reference data, so widening is safe.
  context_ref: TypeNullable(Type.String({ maxLength: 512 })),
  unit: TypeNullable(Type.String({ maxLength: 64 })),
  period_start: TypeNullable(Type.String({ maxLength: 10 })),
  period_end: TypeNullable(Type.String({ maxLength: 10 })),
  period_instant: TypeNullable(Type.String({ maxLength: 10 })),
  value_text: TypeNullable(Type.String()),
  value_numeric: TypeNullable(Type.Number()),
  decimals: TypeNullable(Type.String({ maxLength: 8 })),
  sign: TypeNullable(Type.String({ maxLength: 1 })),
  format: TypeNullable(Type.String({ maxLength: 64 })),
  is_numeric: Type.Boolean(),
  is_hidden: Type.Boolean(),
  dimensions_json: TypeNullable(Type.String()),
  source: Type.String({ maxLength: 16 }), // "inline" | "instance" | "fee-exhibit"
  created_at: Type.String(),
});
export type XbrlFactRow = Static<typeof XbrlFactRowSchema>;

export const XbrlFactPrimaryKeyNames = ["accession_number", "fact_index"] as const;

export type XbrlFactRepositoryStorage = ITabularStorage<
  typeof XbrlFactRowSchema,
  typeof XbrlFactPrimaryKeyNames,
  XbrlFactRow
>;

export const XBRL_FACT_REPOSITORY_TOKEN = createServiceToken<XbrlFactRepositoryStorage>(
  "sec.storage.xbrlFactRepository"
);
