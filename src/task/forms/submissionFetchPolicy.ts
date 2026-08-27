/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which file to fetch for a filing: the whole submission, or its primary
 * document alone.
 *
 * One definition, in a module of its own, because four call sites used to
 * answer this question and they did not all agree. The read path gated 8-Ks on
 * a known-SPAC-plus-trigger-item predicate while both bulk download paths
 * fetched every 8-K's `.txt` unconditionally — so what was on disk for a given
 * 8-K was a function of ingest history rather than of the form, and a consumer
 * could only find out by looking.
 *
 * Its own module rather than a helper inside `ProcessAccessionDocFormTask`
 * because `spacCandidateDownload` already imports the form sets from there; the
 * policy importing back would be a cycle. The sets live here now and that
 * module re-exports them, so nothing downstream had to move.
 */

/**
 * Registration prospectus forms whose body is fetched as the full submission
 * .txt — Form.parse() needs the <SEC-HEADER> and sibling <DOCUMENT> blocks
 * (XBRL instance, EX-FILING FEES exhibit), not just the primary document.
 */
export const REGISTRATION_PROSPECTUS_FORMS = new Set([
  "S-1",
  "S-1/A",
  "S-1MEF",
  "DRS",
  "DRS/A",
  "F-1",
  "F-1/A",
  "F-1MEF",
  "424A",
  "424B1",
  "424B2",
  "424B3",
  "424B4",
  "424B5",
  "424B7",
]);

/**
 * Reg A annual reports, whose body is fetched as the full submission .txt.
 *
 * The financial statements are not in the document the pipeline would otherwise
 * fetch. A 1-K's primary document is `primary_doc.xml` — an XSD cover page with
 * no financial elements at all, which is why 1-K produced 0 financial rows
 * across all 2,997 filings — and the annual report sits beside it as
 * `<TYPE>PART II`. Reading the full submission gets BOTH out of one request.
 *
 * The 1-SA is deliberately NOT here. Its primary document IS its report — every
 * one of the 2,792 filings records a `.htm` primary doc where every one of the
 * 3,001 1-K filings records a `.xml` — so escalating it would fetch the whole
 * submission to arrive at the document already being fetched, and would
 * invalidate a cache that is already holding exactly the right file. Uniformity
 * between the two forms is not worth re-downloading a corpus for.
 */
export const REGA_FULL_SUBMISSION_FORMS = new Set(["1-K", "1-K/A"]);

/**
 * The current-report forms.
 *
 * Fetched whole for EVERY 8-K, with no gate. An 8-K's primary document is
 * routinely four sentences pointing at the EX-99.1 press release that carries
 * the news, so the exhibits are not an extra — for this form they are the
 * filing. Only the full submission carries them, and only it carries the
 * `<TYPE>` / `<DESCRIPTION>` / `<FILENAME>` manifest that says what each one is.
 *
 * The cost is bounded: it is one request either way. What it buys is that
 * "what is cached for this 8-K" stops depending on which path fetched it.
 *
 * Deciding to fetch the whole submission is NOT deciding to feed all of it to
 * an extractor. Those were one flag once, which is why widening the fetch used
 * to mean widening a model's input. They are separate now — see
 * `ProcessAccessionDocFormTask`, where the known-SPAC trigger-item predicate
 * survives unchanged as the gate on what `processForm8K` receives.
 */
export const CURRENT_REPORT_FORMS = new Set(["8-K", "8-K/A"]);

export type SubmissionFetchKind = "full-submission" | "primary-doc";

/** Which file a filing of this form should be fetched as. */
export function submissionFetchKind(form: string): SubmissionFetchKind {
  return REGISTRATION_PROSPECTUS_FORMS.has(form) ||
    REGA_FULL_SUBMISSION_FORMS.has(form) ||
    CURRENT_REPORT_FORMS.has(form)
    ? "full-submission"
    : "primary-doc";
}

/** The full-submission filename EDGAR serves at `…/<accession>.txt`. */
export function fullSubmissionFileName(accessionNumber: string): string {
  return `${accessionNumber}.txt`;
}
