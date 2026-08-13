/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SPAC_CANDIDATE_CONFIDENCES,
  type SpacCandidateConfidence,
} from "../../storage/spac/SpacCandidateSchema";
import { stripXslPrefix } from "../../util/accessionDocPath";
import { REGISTRATION_PROSPECTUS_FORMS } from "../forms/ProcessAccessionDocFormTask";
import { SPAC_REGISTRATION_FORMS } from "./classifySpacCandidate";

export type SpacDownloadSet = "registration" | "8k" | "all";

export const SPAC_DOWNLOAD_8K_FORMS = ["8-K", "8-K/A"] as const;

export const DEFAULT_SPAC_DOWNLOAD_CONFIDENCE: readonly SpacCandidateConfidence[] = [
  "high",
  "medium",
];

/** Same bound as PersonObservationTitleRepo.listForObservations (SQLite variable cap). */
export const MAX_SPAC_DOWNLOAD_CIKS_PER_QUERY = 900;

export type SpacDocFetchKind = "full-submission" | "primary-doc";

export function formsForDownloadSet(set: SpacDownloadSet): ReadonlySet<string> | undefined {
  if (set === "all") return undefined;
  if (set === "8k") return new Set<string>(SPAC_DOWNLOAD_8K_FORMS);
  return new Set<string>(SPAC_REGISTRATION_FORMS);
}

export function spacDocFetchKind(form: string): SpacDocFetchKind {
  if (REGISTRATION_PROSPECTUS_FORMS.has(form) || form === "8-K" || form === "8-K/A") {
    return "full-submission";
  }
  return "primary-doc";
}

export function spacDocFetchFileName(
  form: string,
  accessionNumber: string,
  primaryDoc: string
): string {
  if (spacDocFetchKind(form) === "full-submission") return `${accessionNumber}.txt`;
  return stripXslPrefix(primaryDoc);
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
