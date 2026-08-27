/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";

/**
 * One extraction model call, keyed by everything that went into it.
 *
 * An S-1 and its amendments restate the same prospectus, so a sweep sends the
 * same section text to the same model under the same instructions many times
 * over. Measured across 25 real amendment families (239 documents), a fifth of
 * section-granularity calls are repeats — see `scripts/measureSectionReuse.ts`,
 * which is what decided this was worth building and at what size.
 *
 * A CACHE, not storage. Nothing reads it for data: extraction results are still
 * written per accession by the caller, so the temporal model — which filing
 * asserted what, and when — is untouched by whether a call was answered from
 * here. Truncating this table costs money and no information.
 *
 * Sound only because extraction samples greedily. `SEC_EXTRACTION_TEMPERATURE`
 * is 0, so the same input already yields the same output; the cache makes that
 * cheap rather than making it true. Raising the temperature would make this a
 * lie — the second call would legitimately differ, and serving the first would
 * hide that.
 */
export const ExtractionCacheSchema = Type.Object({
  /**
   * SHA-256 over every input to the call: the section label, the model, the
   * instructions, the output schema, and the section text VERBATIM.
   *
   * Content-addressed all the way down, so nothing here can go stale. Editing a
   * prompt changes the instructions hash and misses; changing a schema changes
   * the schema hash and misses; re-rendering a filing changes the section text
   * and misses. That is why there is no `prompt_version` column to remember to
   * bump — a version number is a promise to update it, and the hash is a fact.
   */
  cache_key: Type.String({ maxLength: 64, description: "SHA-256 of every call input" }),
  /** The section label, e.g. `management`. Carried for observability, not keying. */
  label: Type.String({ maxLength: 64, description: "Section/extractor label" }),
  model_id: Type.String({ maxLength: 128, description: "Resolved model id" }),
  /** Instructions + output schema, so a prompt edit is visible without the text. */
  prompt_sha256: Type.String({ maxLength: 64, description: "SHA-256 of instructions + schema" }),
  /**
   * SHA-256 of the section text as sent — RAW, not normalized.
   *
   * Normalizing before hashing would widen the cache by collapsing texts that
   * differ only in whitespace. Measured, it widens it by almost nothing: across
   * 25 families it added one section pair in eighteen. And it would break the
   * thing that makes carrying a result forward honest — a stored `source_span`
   * asserts a verbatim passage was found IN THIS TEXT, and
   * `field_provenance.method: "anchored"` asserts the field's own value was
   * located in it. Both hold for free while the bytes are identical, and stop
   * holding the moment they are merely similar.
   */
  section_sha256: Type.String({ maxLength: 64, description: "SHA-256 of the raw section text" }),
  section_chars: Type.Integer({ minimum: 0, description: "Length of the cached section text" }),
  /** The validated object the call produced, as JSON. */
  result: Type.String({ description: "JSON of the validated extraction result" }),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
});

export type ExtractionCacheEntry = Static<typeof ExtractionCacheSchema>;

export const ExtractionCachePrimaryKeyNames = ["cache_key"] as const;

export type ExtractionCacheRepositoryStorage = ITabularStorage<
  typeof ExtractionCacheSchema,
  typeof ExtractionCachePrimaryKeyNames,
  ExtractionCacheEntry
>;

export const EXTRACTION_CACHE_REPOSITORY_TOKEN =
  createServiceToken<ExtractionCacheRepositoryStorage>("sec.storage.extractionCacheRepository");
