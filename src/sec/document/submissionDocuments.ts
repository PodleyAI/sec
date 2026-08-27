/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  parseRegistrationSubmission,
  parseSubmissionDocuments,
  selectPrimaryDocument,
  type SubmissionDocument,
} from "../forms/registration-statements/s1/parseSubmission";

/** One document of a submission, ready to convert. */
export interface ConvertibleDocument {
  /** The submission's own `<FILENAME>`. Addresses this document in a URL. */
  readonly docFile: string;
  /** EDGAR's `<TYPE>`: the form for the primary, `EX-99.1` and friends for the rest. */
  readonly docType: string | null;
  /** The filer's `<DESCRIPTION>`, which is what a reader recognises an exhibit by. */
  readonly description: string | null;
  readonly sequence: number | null;
  readonly isPrimary: boolean;
  readonly html: string;
}

/**
 * Document types that are not prose and never will be.
 *
 * `GRAPHIC` is a JPEG, `XML`/`EX-101.*` are the XBRL payload, `EX-FILING FEES`
 * is an iXBRL fee table already parsed structurally elsewhere, and `ZIP` is the
 * iXBRL bundle. Run through the markdown converter each produces either nothing
 * or a page of noise, and the XBRL ones are large enough to matter at rest.
 *
 * The narrower list `parseSubmissionExhibits` uses is not reusable here: it
 * also drops the primary document and everything that is not an `EX-`, which is
 * the opposite of what a directory listing wants.
 */
const SKIP_TYPES = /^(graphic|zip|xml|excel|ex-101\b|ex-filing fees\b)/i;

/**
 * Filename extensions that are not prose either, for the submissions whose
 * `<TYPE>` is missing or lies. A filer mislabelling a JPEG `EX-99.1` is rarer
 * than one omitting the type entirely, and both end the same way without this.
 */
const SKIP_EXTENSIONS = /\.(jpe?g|gif|png|bmp|tiff?|pdf|zip|xlsx?|xsd|json|css|js)$/i;

/** Whether one submission member is worth rendering as markdown. */
function isNarrative(doc: SubmissionDocument, isPrimary: boolean): boolean {
  // The primary document is the filing. Whatever EDGAR calls it, it is what a
  // reader followed the link for, so it is never filtered out.
  if (isPrimary) return true;
  if (doc.filename === null || doc.filename.trim() === "") return false;
  if (doc.type !== null && SKIP_TYPES.test(doc.type.trim())) return false;
  if (SKIP_EXTENSIONS.test(doc.filename.trim())) return false;
  return doc.body.trim() !== "";
}

/**
 * Every document of a submission worth converting, primary first.
 *
 * A submission is a directory, not a file. The primary document is its index —
 * an 8-K's body is four sentences pointing at the EX-99.1 press release that
 * carries the news, and a converter that reads only the primary stores the
 * pointer and drops the disclosure.
 *
 * `fallbackDocFile` names the primary when the text is a bare document body
 * rather than a full submission `.txt`: there are no `<DOCUMENT>` envelopes to
 * read a filename out of, and the caller knows which file it loaded.
 *
 * Ordered primary-first, then by `<SEQUENCE>`, because that ordinal decides
 * which document a bare `/filings/{cik}/{accession}` URL renders and the order
 * the rest are offered in.
 */
export function listConvertibleDocuments(
  form: string | null,
  text: string,
  fallbackDocFile: string
): ConvertibleDocument[] {
  const docs = parseSubmissionDocuments(text);
  if (docs.length === 0) {
    // No envelope: the whole input is one document. `parseRegistrationSubmission`
    // owns stripping a stray SEC-HEADER off it, so this does not repeat that.
    const { html } = parseRegistrationSubmission(form ?? "", text);
    return html.trim() === ""
      ? []
      : [
          {
            docFile: fallbackDocFile,
            docType: form,
            description: null,
            sequence: 1,
            isPrimary: true,
            html,
          },
        ];
  }

  const primary = selectPrimaryDocument(docs, form ?? "");
  const out: ConvertibleDocument[] = [];
  for (const doc of docs) {
    const isPrimary = doc === primary;
    if (!isNarrative(doc, isPrimary)) continue;
    const named = (doc.filename ?? "").trim();
    out.push({
      docFile: named !== "" ? named : fallbackDocFile,
      docType: doc.type,
      description: doc.description,
      sequence: doc.sequence,
      isPrimary,
      html: doc.body,
    });
  }
  // Two members can name the same file — a filer repeating a `<FILENAME>`, or a
  // primary falling back to the same name a later block declares. The row key
  // is that name, so the first wins and the duplicate is dropped rather than
  // silently overwriting the document a reader is looking at.
  const seen = new Set<string>();
  const unique = out.filter((d) => (seen.has(d.docFile) ? false : (seen.add(d.docFile), true)));
  return unique.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER);
  });
}
