/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";
import { TypeSecCik } from "../../util/TypeSecCik";

/**
 * The header row for one filing whose primary document has been converted to
 * markdown. The markdown itself is NOT here — it lives on the
 * `filing_section` rows this row counts.
 *
 * Splitting them that way is what keeps a reader who wants one section from
 * paying for the whole filing: an S-1 renders to the better part of a megabyte
 * of markdown, and "jump to Risk Factors" should be one short row, not that
 * megabyte followed by a scroll. Storing the document markdown here as well
 * would double the table for a copy nothing reads on its own.
 *
 * One converted document per filing, keyed by the filing. A submission carries
 * many files — exhibits, graphics, the XBRL payload — and only the PRIMARY
 * document is the filing as a person reads it; {@link FilingDocumentSchema.doc_file}
 * records which file that was so a later change of mind is visible rather than
 * silent.
 */
export const FilingDocumentSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) - unique identifier for entity" }),
  accession_number: Type.String({
    maxLength: 25,
    description: "SEC accession number - unique identifier for the filing",
  }),
  /**
   * The submission file that was converted, e.g. `tm2412345-1_s1.htm`. Bare
   * name, with EDGAR's inline-XBRL viewer prefix already stripped, matching
   * what the fetch cache is keyed by.
   */
  doc_file: Type.String({ maxLength: 128, description: "Primary document filename converted" }),
  form: TypeNullable(Type.String({ maxLength: 32, description: "Form type, as filed" })),
  filing_date: TypeNullable(
    Type.String({ description: "Date the filing was submitted (YYYY-MM-DD)" })
  ),
  /** Title given to the document tree's root — what the page shows as its heading. */
  title: Type.String({ description: "Document title" }),
  section_count: Type.Integer({ minimum: 0, description: "Number of filing_section rows" }),
  char_count: Type.Integer({
    minimum: 0,
    description: "Total markdown characters across every section",
  }),
  /**
   * Which converter produced this. Compared, not decorative: the sweep skips a
   * filing already converted at the CURRENT version and re-converts one carried
   * over from an older one, so improving the parser is a version bump plus a
   * re-run rather than a truncate.
   *
   * Deliberately a plain string on the row rather than a slot in the
   * `component_versions` tier. That tier models extractors — a prompt, a model,
   * a promote/rollback ceremony over results a human graded. This converter is
   * deterministic and has no grade: the same HTML in is the same markdown out,
   * so the only question a version has to answer is "is this row stale", and a
   * string answers it.
   */
  converter_version: Type.String({ maxLength: 32, description: "Converter version stamp" }),
  converted_at: Type.String({ description: "ISO 8601 timestamp" }),
});

export type FilingDocument = Static<typeof FilingDocumentSchema>;

export const FilingDocumentPrimaryKeyNames = ["cik", "accession_number"] as const;

export type FilingDocumentRepositoryStorage = ITabularStorage<
  typeof FilingDocumentSchema,
  typeof FilingDocumentPrimaryKeyNames,
  FilingDocument
>;

export const FILING_DOCUMENT_REPOSITORY_TOKEN = createServiceToken<FilingDocumentRepositoryStorage>(
  "sec.storage.filingDocumentRepository"
);
