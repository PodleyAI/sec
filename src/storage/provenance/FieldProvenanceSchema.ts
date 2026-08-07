/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * One citation per extracted FIELD, for the object-shaped extractors.
 *
 * Those extractors return one object with many fields and a single
 * `source_span` — sponsor promote carries seven figures scattered across a long
 * table, offering terms about fifteen. One quote cannot honestly stand behind
 * all of them, and models resolve the impossible contract by stitching rows
 * together with "..." separators (they keep doing it when told not to). The
 * wide row keeps its own `source_span` for compatibility; this table is where a
 * real per-field citation lives.
 *
 * Long rather than wide on purpose, mirroring {@link ObservationProvenanceSchema}:
 * values stay in their own typed columns so every existing query keeps working,
 * and provenance grows sideways without a schema change per field.
 */
export const FieldProvenanceSchema = Type.Object({
  extractor_id: Type.String({ maxLength: 16 }),
  accession_number: Type.String({ maxLength: 25 }),
  /** The table the cited value was written to, e.g. `spac_promote_terms`. */
  table_name: Type.String({ maxLength: 64 }),
  /**
   * Row discriminator within `table_name` for tables holding several rows per
   * filing (a ticker series, use-of-proceeds lines). Empty string for the
   * one-row-per-filing tables, so the key stays non-null.
   */
  row_key: Type.String({ maxLength: 64 }),
  /** The column the citation is for, e.g. `founder_shares`. */
  field_name: Type.String({ maxLength: 64 }),
  confidence: TypeNullable(Type.Number({ description: "0..1 model-reported confidence" })),
  source_span: TypeNullable(
    Type.String({ description: "verbatim passage this field's value was drawn from" })
  ),
  /**
   * How the citation was obtained. `model` is the span the model returned for
   * the whole object — the honest reading is "this is the object's citation,
   * not this field's". `anchored` means the field's own value was located in
   * the section text and the surrounding passage taken, which cites the field
   * itself and additionally proves the VALUE came from the document rather than
   * merely proving the model read it.
   */
  method: Type.Union([Type.Literal("model"), Type.Literal("anchored")]),
  model_id: TypeNullable(Type.String({ maxLength: 128 })),
  prompt_version: TypeNullable(Type.String({ maxLength: 32 })),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
});

export type FieldProvenance = Static<typeof FieldProvenanceSchema>;

export const FieldProvenancePrimaryKeyNames = [
  "extractor_id",
  "accession_number",
  "table_name",
  "row_key",
  "field_name",
] as const;

export type FieldProvenanceRepositoryStorage = ITabularStorage<
  typeof FieldProvenanceSchema,
  typeof FieldProvenancePrimaryKeyNames,
  FieldProvenance
>;

export const FIELD_PROVENANCE_REPOSITORY_TOKEN =
  createServiceToken<FieldProvenanceRepositoryStorage>("sec.storage.fieldProvenanceRepository");
