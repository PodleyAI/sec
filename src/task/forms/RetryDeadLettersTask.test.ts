/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { RetryDeadLettersTask } from "./RetryDeadLettersTask";

describe("RetryDeadLettersTask", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => resetDependencyInjectionsForTesting());

  it("reports eligible accessions for a newer version and skips none-eligible", async () => {
    const dl = new ExtractionDeadLetterRepo();
    // Current S-1 version is 1.0.0 (bootstrapped). An entry that failed at 1.0.0
    // is NOT eligible; an entry that failed at a stale 0.9.0 IS eligible.
    await dl.record({
      extractor_id: "S-1",
      accession_number: "acc-stale",
      section_name: "Management",
      reason_code: "MODEL_EMPTY",
      detail: null,
      failed_extractor_version: "0.9.0",
      source_run_id: null,
    });
    await dl.record({
      extractor_id: "S-1",
      accession_number: "acc-current",
      section_name: "Management",
      reason_code: "MODEL_EMPTY",
      detail: null,
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });

    const out = await new RetryDeadLettersTask().run({ extractorId: "S-1", dryRun: true } as any);
    expect(out.eligibleAccessions).toEqual(["acc-stale"]);
  });
});
