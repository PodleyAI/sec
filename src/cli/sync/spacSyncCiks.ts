/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  type SpacCandidateConfidence,
} from "../../storage/spac/SpacCandidateSchema";
import { SPAC_REPOSITORY_TOKEN } from "../../storage/spac/SpacSchema";

// Typed `ReadonlySet<string>` for lookup — the stored column is a plain string
// (`TypeStringEnum` surfaces `string`, not the union) — while the literals are
// still checked against {@link SpacCandidateConfidence}, so a typo is a compile error.
const PROCESS_CONFIDENCES: ReadonlySet<string> = new Set<SpacCandidateConfidence>([
  "high",
  "medium",
]);

/** Known spac rows ∪ spac_candidate rows with confidence high|medium. */
export async function listSpacProcessCiks(): Promise<number[]> {
  const spacRepo = globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN);
  const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);

  const ciks = new Set<number>((await spacRepo.getAll())?.map((row) => row.cik) ?? []);

  let candidates = await candidateRepo.query({
    confidence: { value: ["high", "medium"], operator: "in" },
  });
  if (candidates === undefined) {
    candidates =
      (await candidateRepo.getAll())?.filter((row) => PROCESS_CONFIDENCES.has(row.confidence)) ??
      [];
  }

  for (const row of candidates) {
    ciks.add(row.cik);
  }

  return [...ciks].sort((a, b) => a - b);
}
