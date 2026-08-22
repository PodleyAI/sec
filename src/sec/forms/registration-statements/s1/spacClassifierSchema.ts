/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "workglow";

/**
 * Entity kinds the content classifier distinguishes. `spac` is a true
 * blank-check acquisition vehicle; `shell` is a non-operating shell that is NOT
 * a blank-check IPO vehicle (e.g. a dormant reverse-merger shell); `operating`
 * is a real operating business. Only `spac` flips a miscoded filing to is_spac.
 */
export const SPAC_ENTITY_KINDS = ["spac", "shell", "operating"] as const;
export type SpacEntityKind = (typeof SPAC_ENTITY_KINDS)[number];

/**
 * The single classification object the model returns for a registration filing
 * whose SGML-header SIC was NOT the deterministic blank-check code (6770). Used
 * to catch SIC-miscoded SPACs and distinguish a true SPAC from an ordinary shell
 * or operating company (mirrors the single-object detection extractors).
 */
export const SpacClassificationOutputSchema = {
  type: "object",
  properties: {
    is_spac: {
      type: "boolean",
    },
    entity_kind: { type: "string", enum: SPAC_ENTITY_KINDS },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    source_span: { type: ["string", "null"] },
    nonce_seen: { type: "string", pattern: "^[0-9a-f]{16}$" },
  },
  required: ["is_spac", "entity_kind", "confidence", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface SpacClassificationRow {
  is_spac: boolean;
  entity_kind: SpacEntityKind;
  confidence: number;
  source_span: string;
  /**
   * Marks a row as produced by the model-free table parse — asserted by that
   * parser's unit tests, and absent from the model's JSON schema. Persist does
   * not read it: the provenance model id comes from `SectionPersistMeta.source`.
   */
  source?: "deterministic";
}
