/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SPAC_CANDIDATE_CONFIDENCES,
  type SpacCandidateConfidence,
} from "../../storage/spac/SpacCandidateSchema";
import { resolvePrimaryDocName } from "../../util/accessionDocPath";
import { submissionFetchKind } from "../forms/submissionFetchPolicy";
import type { SubmissionFetchKind } from "../forms/submissionFetchPolicy";
import { SPAC_REGISTRATION_FORMS } from "./classifySpacCandidate";

export type SpacDownloadSet = "registration" | "8k" | "all";

export const SPAC_DOWNLOAD_8K_FORMS = ["8-K", "8-K/A"] as const;

export const DEFAULT_SPAC_DOWNLOAD_CONFIDENCE: readonly SpacCandidateConfidence[] = [
  "high",
  "medium",
];

/** Same bound as PersonObservationTitleRepo.listForObservations (SQLite variable cap). */
export const MAX_SPAC_DOWNLOAD_CIKS_PER_QUERY = 900;

/**
 * Rows read from `filings` per round trip.
 *
 * The worklist scan is a cursor walk rather than one `query()` per CIK chunk,
 * so this — not the chunk size — is what bounds the rows held at once. A chunk
 * is 900 candidates' filings, which for `everything` is a candidate's ENTIRE
 * history times 900; materializing that only to keep the handful still needing
 * a download is the largest allocation the command makes before it has fetched
 * anything.
 */
export const SPAC_DOWNLOAD_FILING_PAGE_SIZE = 2_000;

/**
 * Bound parameters left for everything that is not a CIK, so a CIK chunk plus a
 * form list plus the keyset predicate stays under SQLite's legacy
 * `SQLITE_MAX_VARIABLE_NUMBER` of 999. The form list is the part that grows
 * ({@link SPAC_REGISTRATION_FORMS} is 8 today), and the keyset predicate adds
 * one per primary-key column per tier — hence a margin rather than an exact
 * count. Postgres binds an `in` list as a single array parameter and is not
 * subject to this at all.
 */
const NON_CIK_PARAMETER_BUDGET = 32;

/**
 * How many CIKs may go into one `in` list alongside `forms`.
 *
 * Derived rather than a flat constant: narrowing the scan by form is what stops
 * the database returning a SPAC's whole filing history for an `8k` run, and it
 * spends parameters to do it. Adding a form to
 * {@link SPAC_REGISTRATION_FORMS} therefore shrinks the chunk instead of
 * silently breaching the cap.
 */
export function spacDownloadCikChunkSize(formCount: number): number {
  const budget = MAX_SPAC_DOWNLOAD_CIKS_PER_QUERY - formCount - NON_CIK_PARAMETER_BUDGET;
  return Math.max(1, budget);
}

/**
 * Kept as an alias of {@link SubmissionFetchKind} rather than a second union:
 * `sec spac download` and the forms read path ask the same question, and two
 * spellings of the answer is how they drifted apart in the first place.
 */
export type SpacDocFetchKind = SubmissionFetchKind;

export function formsForDownloadSet(set: SpacDownloadSet): ReadonlySet<string> | undefined {
  if (set === "all") return undefined;
  if (set === "8k") return new Set<string>(SPAC_DOWNLOAD_8K_FORMS);
  return new Set<string>(SPAC_REGISTRATION_FORMS);
}

/**
 * Delegates to the shared policy. Kept as a named export because the download
 * sweep and its tests read for this name, but it decides nothing of its own:
 * the download path answering differently from the read path is exactly the
 * drift the shared module exists to prevent.
 */
export function spacDocFetchKind(form: string): SpacDocFetchKind {
  return submissionFetchKind(form);
}

/**
 * The document filename to fetch for a filing, or `""` when the filing names
 * none.
 *
 * `Filing.primary_doc` is nullable (EDGAR also serves it as an empty string),
 * so the primary-doc branch resolves through {@link resolvePrimaryDocName}
 * rather than stripping the viewer prefix off a value that may be `null`. `""`
 * is the sentinel the caller's empty-name guard already consumes, which turns
 * a filing with no named document into one skipped row instead of a throw that
 * takes the whole sweep down.
 */
export function spacDocFetchFileName(
  form: string,
  accessionNumber: string,
  primaryDoc: string | null | undefined
): string {
  if (spacDocFetchKind(form) === "full-submission") return `${accessionNumber}.txt`;
  return resolvePrimaryDocName(primaryDoc) ?? "";
}

export function accessionDocCacheRelative(
  cik: number,
  accessionNumber: string,
  fileName: string
): string {
  return `accessiondocs/${cik.toString().padStart(10, "0")}/${accessionNumber.replaceAll("-", "")}-${fileName}`;
}

export function parseSpacDownloadConfidence(csv: string | undefined): SpacCandidateConfidence[] {
  const raw =
    csv === undefined || csv.trim() === "" ? DEFAULT_SPAC_DOWNLOAD_CONFIDENCE.join(",") : csv;
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const allowed = new Set<string>(SPAC_CANDIDATE_CONFIDENCES);
  const out: SpacCandidateConfidence[] = [];
  for (const token of tokens) {
    if (!allowed.has(token)) {
      throw new Error(
        `Invalid --confidence "${token}". Must be one of: ${SPAC_CANDIDATE_CONFIDENCES.join(", ")}.`
      );
    }
    out.push(token as SpacCandidateConfidence);
  }
  if (out.length === 0) {
    throw new Error(
      `Invalid --confidence "${csv}". Must be one of: ${SPAC_CANDIDATE_CONFIDENCES.join(", ")}.`
    );
  }
  return out;
}
