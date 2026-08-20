/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { MERGER_PROXY_SECTION } from "../versioning/extractorIds";
import { ExtractionDeadLetterRepo } from "./ExtractionDeadLetterRepo";

/** The extractor whose entries answer for the merger section. */
const MERGER_PROXY_EXTRACTOR_ID = "merger-proxy";

/**
 * Of the given accessions, those whose merger-proxy run already answered for
 * the merger section — in ANY status.
 *
 * A RESOLVED entry is the evidence, not noise. Most general proxies carry no
 * merger section at all (annual meetings, extension votes), and the processor
 * writes no extraction row for one; the resolved `SECTION_NOT_FOUND` trace it
 * records instead is the only durable mark that it looked. Both selection
 * predicates over merger proxies — `sec spac process` and
 * `sec extractor backfill merger-proxy` — read it, so they share one query and
 * cannot disagree about what counts as answered.
 */
export async function loadAnsweredMergerSections(
  accession_numbers: readonly string[]
): Promise<ReadonlySet<string>> {
  const rows = await new ExtractionDeadLetterRepo().listByAccessions(accession_numbers, [
    MERGER_PROXY_EXTRACTOR_ID,
  ]);
  return new Set(
    rows
      .filter((row) => row.section_name === MERGER_PROXY_SECTION)
      .map((row) => row.accession_number)
  );
}
