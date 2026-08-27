/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../util/TypeSecCik";

/**
 * One heading's worth of one document's markdown. These rows ARE the document —
 * concatenated in `ordinal` order within a `doc_file` they reproduce it exactly — and they are the
 * unit everything downstream reads: a section link, a highlight, and (later) a
 * full-text index.
 *
 * Flat and non-overlapping. A nested subsection is its own row rather than text
 * repeated inside its parent, so a long filing is stored once; `depth` carries
 * the nesting instead. A section's full extent, the thing a reader means by
 * "show me Risk Factors", is this row plus the following run of rows with a
 * greater depth — computed at read time, in exchange for not storing the
 * document several times over. See `splitDocumentSections`.
 *
 * No `tsvector` column, and that is not an omission. Postgres caps a tsvector
 * at 1 MB, which is why the index belongs on these rows rather than on a whole
 * filing — but it can be an EXPRESSION index over `markdown` when full-text
 * search lands, needing no column here and so no migration of this table.
 */
export const FilingSectionSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) - unique identifier for entity" }),
  accession_number: Type.String({
    maxLength: 25,
    description: "SEC accession number - unique identifier for the filing",
  }),
  /**
   * Which member of the submission these sections came from, matching
   * `filing_document.doc_file`. Part of the key: an 8-K's primary document and
   * its EX-99.1 press release are two documents, each with its own ordinal 0.
   */
  doc_file: Type.String({ maxLength: 128, description: "Submission filename converted" }),
  /** Document order, 0-based. The sort key that rebuilds the filing. */
  ordinal: Type.Integer({ minimum: 0, description: "Position in document order" }),
  /**
   * URL-safe identifier, unique within one document — what `?section=` names.
   *
   * Derived from the heading rather than from {@link FilingSectionSchema.ordinal}
   * because a link outlives a conversion: an ordinal shifts the moment the
   * parser starts or stops recognising one heading, and every link ever shared
   * would then point at a different section without appearing to have changed.
   */
  slug: Type.String({ maxLength: 96, description: "URL-safe section identifier" }),
  title: Type.String({ description: "Heading text, as filed" }),
  /** Heading level 1-6; 0 for the preamble ahead of the first heading. */
  depth: Type.Integer({ minimum: 0, maximum: 6, description: "Heading level" }),
  char_count: Type.Integer({ minimum: 0, description: "Length of this section's markdown" }),
  markdown: Type.String({ description: "This section's markdown, heading included" }),
});

export type FilingSection = Static<typeof FilingSectionSchema>;

export const FilingSectionPrimaryKeyNames = [
  "cik",
  "accession_number",
  "doc_file",
  "ordinal",
] as const;

export type FilingSectionRepositoryStorage = ITabularStorage<
  typeof FilingSectionSchema,
  typeof FilingSectionPrimaryKeyNames,
  FilingSection
>;

export const FILING_SECTION_REPOSITORY_TOKEN = createServiceToken<FilingSectionRepositoryStorage>(
  "sec.storage.filingSectionRepository"
);
