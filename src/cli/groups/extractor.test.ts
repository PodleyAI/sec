/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { countEligibleDeadLetters } from "./extractor";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";

describe("countEligibleDeadLetters", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => resetDependencyInjectionsForTesting());

  it("counts pending entries that failed under a different version than current", async () => {
    const dl = new ExtractionDeadLetterRepo();
    await dl.record({
      extractor_id: "S-1",
      accession_number: "a",
      section_name: "Management",
      reason_code: "MODEL_EMPTY",
      detail: null,
      failed_extractor_version: "0.9.0",
      source_run_id: null,
    });
    expect(await countEligibleDeadLetters("S-1")).toBe(1);
  });
});
