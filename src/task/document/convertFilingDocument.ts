/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  splitDocumentSections,
  type FilingSectionSlice,
} from "../../sec/document/documentSections";
import { parseRegistrationSubmission } from "../../sec/forms/registration-statements/s1/parseSubmission";
import { parseEdgarHtml } from "../../sec/html/parseEdgarHtml";

/**
 * Stamp written onto every converted row and compared by the sweep.
 *
 * Bump this when a change to the parser, the de-paginator or the section split
 * changes what a reader would see. The sweep re-converts anything carrying an
 * older stamp, so improving the converter is a bump plus a re-run rather than a
 * truncate — and a half-finished re-run leaves the old rows readable instead of
 * leaving a hole.
 */
export const FILING_CONVERTER_VERSION = "2";

/** What one conversion produced, before it is written anywhere. */
export interface ConvertedFilingDocument {
  readonly title: string;
  readonly sections: readonly FilingSectionSlice[];
  readonly charCount: number;
}

/**
 * A human-readable title for the document tree's root.
 *
 * The form and accession rather than the filer's name: this is what the parser
 * labels the root with and what the reader sees above the first heading, and
 * the filer's name is already on the page around it.
 */
export const filingDocumentTitle = (form: string | null, accessionNumber: string): string =>
  `${(form ?? "Filing").trim() || "Filing"} ${accessionNumber}`;

/**
 * Convert one filing's source text into ordered markdown sections.
 *
 * `text` is whatever the fetch cache holds for the filing — a full-submission
 * `.txt` for the prospectus forms, a bare primary document for everything else.
 * `parseRegistrationSubmission` accepts both and answers with the primary
 * document body either way, which is what lets this take the cached file as it
 * finds it rather than re-deriving the forms pipeline's fetch branch (a branch
 * that, for 8-Ks, depends on a SPAC lookup that has nothing to do with reading
 * a filing).
 */
export function convertFilingDocument(
  form: string | null,
  accessionNumber: string,
  text: string
): ConvertedFilingDocument {
  const title = filingDocumentTitle(form, accessionNumber);
  const { html } = parseRegistrationSubmission(form ?? "", text);
  const doc = parseEdgarHtml(html, title);
  const sections = splitDocumentSections(doc);
  return {
    title,
    sections,
    charCount: sections.reduce((sum, section) => sum + section.markdown.length, 0),
  };
}
