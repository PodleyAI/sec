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
 * A DENYLIST, so a member EDGAR invents next year is readable by default rather
 * than silently absent. The trade is stated rather than assumed: the failure
 * mode of a denylist is a junk document appearing in a filing's directory
 * listing, and the failure mode of an allowlist is a real exhibit disappearing
 * from one with nothing to indicate it. The first is visible and cheap to fix;
 * the second is invisible.
 *
 * The axis is NOT-PROSE, and only that. Everything here is machine data,
 * markup, or binary — nothing is excluded for being dull. Boilerplate that is
 * genuinely prose (an auditor's consent, a SOX certification) stays: a
 * directory listing that quietly omits documents a filing contains is not a
 * listing of that filing.
 *
 * Built from EDGAR's published document-type vocabulary rather than measured
 * against a corpus — there is no local document cache to count. Anything it
 * misses is one regex away, and the {@link isBinaryEnvelope} check catches the
 * mislabelled cases this cannot see.
 *
 * The narrower list `parseSubmissionExhibits` uses is not reusable here: it
 * also drops the primary document and everything that is not an `EX-`, which is
 * the opposite of what a directory listing wants.
 */
const SKIP_TYPES = new RegExp(
  [
    // Binary and media. `GRAPHIC` is EDGAR's own type for an embedded image.
    "^(graphic|zip|excel|pdf|audio|video)$",
    // Markup and structured data submitted as a member in its own right.
    "^(xml|xsd|json|sgml)$",
    // XBRL, in every generation EDGAR has shipped: EX-100 (the 2005 voluntary
    // program), EX-101 (INS/SCH/CAL/DEF/LAB/PRE), EX-104 (cover-page iXBRL).
    "^ex-10[014]\\b",
    // The iXBRL filing-fee table. Tagged data with a rendering, not a document,
    // and the fee figures are already parsed structurally elsewhere.
    "^ex-filing fees\\b",
    // The legacy Article 5 financial data schedule: a fixed-field numeric dump.
    "^ex-27\\b",
  ].join("|"),
  "i"
);

/**
 * Filename extensions that are not prose either, for the members whose `<TYPE>`
 * is missing or lies.
 *
 * Checked in addition to the type rather than instead of it. A filer omitting
 * `<TYPE>` entirely is commoner than one mislabelling a JPEG `EX-99.1`, and
 * both end the same way without this.
 *
 * Applied to non-primary members only. The primary document is the filing
 * whatever it is named — and the one shape that would matter, a `.xml` cover
 * page, belongs to forms this converter is not asked about.
 */
const SKIP_EXTENSIONS =
  /\.(jpe?g|gif|png|bmp|tiff?|svg|webp|ico|pdf|zip|gz|tar|xlsx?|xlsm|xsd|xml|json|sgml|css|js|mp[34]|wav|mov)$/i;

/**
 * A member whose `<TEXT>` body is a binary envelope rather than the file.
 *
 * The same predicate `extractPrimaryDocFromSubmission` refuses to cache on, and
 * for the same reason: a `<PDF>` or uuencoded body is not the document, it is a
 * wrapper around bytes the SGML cannot losslessly carry. The type and extension
 * rules catch the honest cases; this catches the filer who labels a PDF
 * `EX-99.1` and names it `.htm`, which would otherwise render as pages of
 * mojibake with no sign anything went wrong.
 */
function isBinaryEnvelope(body: string): boolean {
  return /^\s*<PDF>/i.test(body) || /^\s*begin \d{3} /i.test(body);
}

/** Whether one submission member is worth rendering as markdown. */
function isNarrative(doc: SubmissionDocument, isPrimary: boolean): boolean {
  // The primary document is the filing. Whatever EDGAR calls it, it is what a
  // reader followed the link for — but a binary body is still not text, and
  // rendering one produces a document rather than an honest absence.
  if (isBinaryEnvelope(doc.body)) return false;
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
  // Ordered BEFORE the de-duplication below, not after. Two members can name
  // the same file — a filer repeating a `<FILENAME>`, or a primary with no name
  // of its own falling back to one a sibling declares — and the de-duplication
  // keeps the first. Run on document order, "first" can be the exhibit, so the
  // PRIMARY is the row that gets dropped: the converter then stores a
  // submission with no primary, the sweep's anti-join keys on exactly that row,
  // and the filing is re-selected on every sweep forever.
  const ordered = [...out].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER);
  });
  // The row key is the filename, so the duplicate is dropped rather than
  // silently overwriting the document a reader is looking at.
  const seen = new Set<string>();
  return ordered.filter((d) => (seen.has(d.docFile) ? false : (seen.add(d.docFile), true)));
}
