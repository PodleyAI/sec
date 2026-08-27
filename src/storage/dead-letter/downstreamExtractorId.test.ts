/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ExtractionDeadLetterRepo } from "./ExtractionDeadLetterRepo";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "./ExtractionDeadLetterSchema";

/**
 * A downstream package names its extractors for what they read, so its ids run
 * longer than the ones this package ships. The dead-letter table has to hold
 * them, or a failure in such an extractor reaches the run ledger and the
 * console but never the table `retry-dead-letters` reads.
 */
describe("dead letters accept a downstream extractor id", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("records one whose id is longer than the ids this package ships", async () => {
    const repo = new ExtractionDeadLetterRepo(
      globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN)
    );
    const extractor_id = "rega-financials-1sa";
    expect(extractor_id.length).toBeGreaterThan(16);

    await repo.record({
      extractor_id,
      accession_number: "0000000000-26-000001",
      section_name: "",
      reason_code: "PARSE_ERROR",
      detail: "a downstream extractor failed",
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });

    const pending = await repo.listPending(extractor_id);
    expect(pending.map((d) => d.extractor_id)).toEqual([extractor_id]);
  });
});
