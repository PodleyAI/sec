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

  it("releases each accession's owned workflow instead of retaining the whole sweep", async () => {
    const dl = new ExtractionDeadLetterRepo();
    for (let i = 0; i < 5; i++) {
      await dl.record({
        extractor_id: "S-1",
        accession_number: `acc-${i}`,
        section_name: "Management",
        reason_code: "MODEL_EMPTY",
        detail: null,
        failed_extractor_version: "0.9.0",
        source_run_id: null,
      });
    }

    const task = new RetryDeadLettersTask();
    // A post-run count alone cannot tell "held all five, then dropped them"
    // from "never held more than one", so sample the live count as each
    // wrapper is added. ProcessAccessionDocFormTask throws "Filing not found"
    // for these unseeded accessions — the task catches and counts that, and
    // the ownership churn still happens, deterministically and without network.
    let peak = 0;
    task.subGraph.on("task_added", () => {
      peak = Math.max(peak, task.subGraph.getTasks().length);
    });

    const out = await task.run({ extractorId: "S-1" } as any);
    expect(out.eligibleAccessions).toHaveLength(5);
    expect(peak).toBe(1);
    expect(task.subGraph.getTasks()).toHaveLength(0);
  });
});
