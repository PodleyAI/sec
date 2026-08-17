/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finds the document inside a Reg A full submission that carries the financial
 * statements.
 *
 * This exists because the financials are NOT in the document the pipeline
 * fetches. `ProcessAccessionDocFormTask` reads each filing's primary document,
 * which for a 1-K is `primary_doc.xml` — the XSD-tagged cover page. The annual
 * report itself is a SEPARATE document in the same submission, tagged
 * `<TYPE>PART II`, and nothing was reading it: 1-K produced 0 financial rows
 * across all 2,997 filings because its XSD has no financial elements at all.
 *
 * Selection is on the SGML `<TYPE>` tag rather than on filename or document
 * order, and that is load-bearing. Filenames follow no convention whatsoever
 * (`sixdbytes_1k.htm`, `ea0274451-1k_figpub.htm`, `reig_1k-123125.htm`), and
 * order fails outright on filings like Frontieras, whose first HTML document is
 * `exhibit_6-2c.htm` — a material contract. `<TYPE>` is assigned by EDGAR from
 * the filer's own submission header, so it is the one reliable discriminator.
 *
 * Measured over a 60-filing sample: every 1-K carries exactly one `PART II`
 * (30/30) and every 1-SA exactly one `1-SA` document (30/30) — no filing in the
 * sample was ambiguous.
 */

/**
 * Marks a document EDGAR tags with the filing's own form name rather than a
 * fixed label — resolved per filing by {@link selectByFormType}.
 */
const FORM_NAMED_DOCUMENT = "\u0000form-named";

/**
 * The `<TYPE>` holding the financial statements, per Reg A report form.
 *
 * A 1-K's annual report is tagged `PART II` whatever the form is called, so an
 * amendment resolves to the same document type. A 1-SA's report is tagged with
 * the FORM NAME, which for an amendment is `1-SA/A` — see
 * {@link selectByFormType} for how that is resolved.
 */
const REPORT_DOCUMENT_TYPE: Readonly<Record<string, string>> = {
  "1-K": "PART II",
  "1-SA": FORM_NAMED_DOCUMENT,
};

export interface RegAReportDocument {
  /** The filer's own filename, for provenance. */
  readonly fileName: string;
  /** The document body — HTML, ready for {@link parseRegAFinancialStatements}. */
  readonly body: string;
}

/** Normalizes `1-k/a` / `1-K/A` to the base form the document map is keyed on. */
const baseForm = (form: string): string => form.trim().toUpperCase().replace(/\/A$/, "");

/**
 * Removes EDGAR's `<XML>` envelope from an XML document body.
 *
 * The two submission formats disagree here, and the difference is silent. The
 * PUBLIC `<accession>.txt` wraps an XML member's body in `<XML>…</XML>`; the
 * `.nc` dissemination feed the bulk cache is built from does not, so its bodies
 * really are byte-identical to the per-document files EDGAR serves. Left in
 * place, `<XML>` becomes the document root and `edgarSubmission` — which every
 * caller reads as the root — is silently `undefined`.
 *
 * Both formats reach this code: the forms pipeline reads whichever of the two
 * the cache holds, so stripping has to be tolerant rather than assumed.
 */
function stripXmlWrapper(body: string): string {
  const match = body.match(/^\s*<XML>\s*([\s\S]*?)\s*<\/XML>\s*$/i);
  return match ? match[1] : body;
}

/**
 * Extracts the one document of a given SGML `<TYPE>` from a full-submission
 * `.txt`.
 *
 * Returns `undefined` when the submission carries no such document, which the
 * caller should treat as "nothing to extract" rather than as an error.
 */
export function selectSubmissionDocumentByType(
  submissionText: string,
  type: string
): RegAReportDocument | undefined {
  const wanted = type.trim().toUpperCase();
  const documents = /<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/g;
  let match: RegExpExecArray | null;
  while ((match = documents.exec(submissionText)) !== null) {
    const inner = match[1];
    const found = inner
      .match(/<TYPE>\s*([^\r\n<]+)/i)?.[1]
      .trim()
      .toUpperCase();
    if (found !== wanted) continue;

    const body = inner.match(/<TEXT>\s*([\s\S]*?)\s*<\/TEXT>/i)?.[1];
    if (body === undefined) return undefined;
    // A binary member's <TEXT> is a wrapper, not the file. A scanned-PDF annual
    // report carries no parseable tables, so there is nothing to recover.
    if (/^\s*<PDF>/i.test(body) || /^\s*begin \d{3} /i.test(body)) return undefined;

    return {
      fileName: inner.match(/<FILENAME>\s*([^\r\n<]+)/i)?.[1].trim() ?? "",
      body: stripXmlWrapper(body),
    };
  }
  return undefined;
}

/**
 * Resolves a document type that may be named after the filing's own form.
 *
 * EDGAR tags a form-named document with the form AS FILED, so an amendment's is
 * `1-K/A` or `1-SA/A`, not the base form. Resolving to the base name found no
 * document at all: every one of the 125 `1-K/A` filings failed its parse
 * (`carries no <TYPE>1-K/A cover document`) and all 84 `1-SA/A` filings
 * extracted zero figures while still recording a clean run.
 *
 * The exact form is tried first and the base form second, so both a plain
 * filing and an amendment resolve, and a filer that tags an amendment with the
 * base name is still read.
 */
function selectByFormType(
  submissionText: string,
  form: string,
  wanted: string
): RegAReportDocument | undefined {
  if (wanted !== FORM_NAMED_DOCUMENT) {
    return selectSubmissionDocumentByType(submissionText, wanted);
  }
  return (
    selectSubmissionDocumentByType(submissionText, form.trim().toUpperCase()) ??
    selectSubmissionDocumentByType(submissionText, baseForm(form))
  );
}

/**
 * Extracts the financial-statement document from a full-submission `.txt`.
 *
 * An amended annual report is still a `PART II`, so `1-K/A` resolves to the same
 * document type as `1-K`. A `1-SA/A`'s report is tagged with the form as filed,
 * which {@link selectByFormType} resolves.
 *
 * Returns `undefined` when the submission carries no such document, which the
 * caller should treat as "nothing to extract" rather than as an error: a filing
 * may legitimately incorporate its financials by reference.
 */
export function selectRegAReportDocument(
  submissionText: string,
  form: string
): RegAReportDocument | undefined {
  const wanted = REPORT_DOCUMENT_TYPE[baseForm(form)];
  if (wanted === undefined) return undefined;
  return selectByFormType(submissionText, form, wanted);
}

/**
 * The `<TYPE>` holding the XSD-tagged cover page, per form.
 *
 * Only the 1-K has one. That asymmetry is the whole reason the two forms need
 * different handling, and it is visible in the corpus: every one of the 3,001
 * 1-K filings records a `.xml` primary document, and every one of the 2,792
 * 1-SA filings records a `.htm` one. A 1-SA's `<TYPE>1-SA` document IS its
 * report — there is no second, structured document behind it — so asking for a
 * 1-SA cover would hand back the report HTML and invite a caller to parse it as
 * `edgarSubmission` XML.
 */
const COVER_DOCUMENT_TYPE: Readonly<Record<string, string>> = {
  "1-K": FORM_NAMED_DOCUMENT,
};

/**
 * Extracts the XSD-tagged cover page from a full-submission `.txt`.
 *
 * Selected by `<TYPE>` rather than by the filename `primary_doc.xml`, so the
 * same rule that finds the report finds its cover and neither depends on a
 * filename convention.
 *
 * This is what lets one fetch serve both halves of a 1-K: the cover XML carries
 * the issuer, tier and offering data the existing extractor reads, and the
 * PART II document carries the financial statements it never could. Returns
 * `undefined` for a form that has no separate cover.
 */
export function selectRegACoverDocument(
  submissionText: string,
  form: string
): RegAReportDocument | undefined {
  const wanted = COVER_DOCUMENT_TYPE[baseForm(form)];
  if (wanted === undefined) return undefined;
  return selectByFormType(submissionText, form, wanted);
}
