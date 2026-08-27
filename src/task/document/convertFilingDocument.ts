/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  splitDocumentSections,
  type FilingSectionSlice,
} from "../../sec/document/documentSections";
import {
  listConvertibleDocuments,
  type ConvertibleDocument,
} from "../../sec/document/submissionDocuments";
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
export const FILING_CONVERTER_VERSION = "4";

/** What converting one member of a submission produced, before it is stored. */
export interface ConvertedFilingDocument {
  readonly docFile: string;
  readonly docType: string | null;
  readonly description: string | null;
  readonly sequence: number | null;
  readonly isPrimary: boolean;
  readonly title: string;
  readonly sections: readonly FilingSectionSlice[];
  readonly charCount: number;
}

/**
 * A human-readable title for one document's tree root.
 *
 * The primary document is titled by form and accession rather than by the
 * filer's name: that is what the parser labels the root with and what the
 * reader sees above the first heading, and the filer's name is already on the
 * page around it. An exhibit is titled by what EDGAR calls it and what the
 * filer said it was — `EX-99.1 Press release dated March 3, 2026` — because
 * "8-K 0001493152-26-025047" repeated down a list of six exhibits identifies
 * none of them.
 */
export function filingDocumentTitle(
  form: string | null,
  accessionNumber: string,
  doc?: Pick<ConvertibleDocument, "isPrimary" | "docType" | "description"> | undefined
): string {
  const filingTitle = `${(form ?? "Filing").trim() || "Filing"} ${accessionNumber}`;
  if (doc === undefined || doc.isPrimary) return filingTitle;
  const type = (doc.docType ?? "").trim();
  const description = (doc.description ?? "").trim();
  // A description that only restates the type adds nothing; plenty of filers
  // set `<DESCRIPTION>EX-99.1`.
  const restates = description === "" || description.toLowerCase() === type.toLowerCase();
  if (type === "") return description === "" ? filingTitle : description;
  return restates ? type : `${type} ${description}`;
}

/**
 * Convert every narrative member of one submission into ordered markdown
 * sections, primary document first.
 *
 * `text` is whatever the fetch cache holds for the filing — a full-submission
 * `.txt` for most forms, a bare primary document for a filing cached by an
 * older route. {@link listConvertibleDocuments} accepts both and answers with
 * the members either way, which is what lets this take the cached file as it
 * finds it rather than re-deriving the forms pipeline's fetch branch (a branch
 * that, for 8-Ks, depends on a SPAC lookup that has nothing to do with reading
 * a filing).
 *
 * A member that parses to no sections is dropped rather than stored empty: an
 * exhibit that is a signature page of images has nothing to render, and a row
 * claiming otherwise makes a blank page instead of an honest absence.
 */
export function convertFilingSubmission(
  form: string | null,
  accessionNumber: string,
  text: string,
  fallbackDocFile: string
): ConvertedFilingDocument[] {
  const out: ConvertedFilingDocument[] = [];
  for (const doc of listConvertibleDocuments(form, text, fallbackDocFile)) {
    const title = filingDocumentTitle(form, accessionNumber, doc);
    const sections = splitDocumentSections(parseEdgarHtml(doc.html, title));
    if (sections.length === 0) continue;
    out.push({
      docFile: doc.docFile,
      docType: doc.docType,
      description: doc.description,
      sequence: doc.sequence,
      isPrimary: doc.isPrimary,
      title,
      sections,
      charCount: sections.reduce((sum, section) => sum + section.markdown.length, 0),
    });
  }
  return out;
}
