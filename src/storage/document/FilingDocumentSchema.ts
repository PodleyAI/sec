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
 * One row per DOCUMENT, not per filing. A submission is a directory: the
 * primary document plus the exhibits filed with it, and for an 8-K the
 * disclosure is routinely in the exhibit rather than the four sentences of
 * primary that point at it. {@link FilingDocumentSchema.doc_file} is part of
 * the key, and {@link FilingDocumentSchema.is_primary} marks the one a bare
 * `/filings/{cik}/{accession}` URL renders — the directory's index.
 *
 * Graphics, XBRL payloads and the fee exhibit are not rows here. They are
 * members of the submission but not prose, and a directory listing of things
 * that render to noise is worse than one that admits its scope.
 */
export const FilingDocumentSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) - unique identifier for entity" }),
  accession_number: Type.String({
    maxLength: 25,
    description: "SEC accession number - unique identifier for the filing",
  }),
  /**
   * The submission member this row is, e.g. `tm2412345-1_s1.htm` or
   * `ex99-1.htm` — the `<FILENAME>` EDGAR serves it under, so the URL segment
   * naming a document here is the same string EDGAR uses.
   *
   * Part of the primary key. For a submission cached as a bare primary-document
   * body, with no `<DOCUMENT>` envelopes to read a name out of, this is the
   * filename the fetch cache is keyed by.
   */
  doc_file: Type.String({ maxLength: 128, description: "Submission filename converted" }),
  /**
   * EDGAR's `<TYPE>` for this member: the form for the primary document,
   * `EX-99.1` and friends for the exhibits. Null when the submission declares
   * none.
   */
  doc_type: TypeNullable(Type.String({ maxLength: 32, description: "EDGAR document type" })),
  /** The filer's `<DESCRIPTION>`, which is what a reader recognises an exhibit by. */
  description: TypeNullable(Type.String({ maxLength: 512, description: "Document description" })),
  /** EDGAR's `<SEQUENCE>`; the order the submission lists its members in. */
  sequence: TypeNullable(Type.Integer({ minimum: 0, description: "Position in the submission" })),
  /**
   * Whether this is the document the filing IS, as opposed to something filed
   * with it. Exactly one row per accession carries it, and it is the row a URL
   * with no document segment resolves to.
   */
  is_primary: Type.Boolean({ description: "The submission's primary document" }),
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

export const FilingDocumentPrimaryKeyNames = ["cik", "accession_number", "doc_file"] as const;

export type FilingDocumentRepositoryStorage = ITabularStorage<
  typeof FilingDocumentSchema,
  typeof FilingDocumentPrimaryKeyNames,
  FilingDocument
>;

export const FILING_DOCUMENT_REPOSITORY_TOKEN = createServiceToken<FilingDocumentRepositoryStorage>(
  "sec.storage.filingDocumentRepository"
);
