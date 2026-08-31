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

  it("refuses an id this deployment registers no extractor for", async () => {
    // `db setup` seeds a version slot for every id in the CLI's vocabulary,
    // including readings a consumer ships. Without a guard the slot resolves,
    // the dead letters list, and every filing reaches a dispatch that finds no
    // extractor and returns success — each counts as reprocessed, none
    // resolves, and the identical set is re-selected on every later run.
    // Refused by name, through the same predicate `extractor backfill` and the
    // worklist both use.
    await expect(
      new RetryDeadLettersTask({ defaults: { extractorId: "merger-proxy" } }).run()
    ).rejects.toThrow(/registers no extractor under that id/);
  });

  it("resolves expected-negative 8-K detector entries without reprocessing the filing", async () => {
    const dl = new ExtractionDeadLetterRepo();
    await dl.record({
      extractor_id: "redemption",
      accession_number: "no-such-filing",
      section_name: "redemption",
      reason_code: "MODEL_EMPTY",
      detail: null,
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });

    const out = await new RetryDeadLettersTask().run({ extractorId: "redemption" } as never);
    expect(out.eligibleAccessions).toEqual(["no-such-filing"]);
    // Counted as `resolved`, not `reprocessed`: no filing went back through the
    // pipeline. `reprocessed` claims work happened, and the accession here does
    // not even resolve to a filing.
    expect(out.resolved).toBe(1);
    expect(out.reprocessed).toBe(0);
    expect(out.failed).toBe(0);
    expect((await dl.get("redemption", "no-such-filing", "redemption"))?.status).toBe("resolved");
  });

  it("does not resolve a redemption MODEL_INVALID_OUTPUT entry without re-running the filing", async () => {
    // Recorded at a STALE version so it is eligible the ordinary way; the point
    // is that it takes the REPROCESS branch rather than the resolve-only one.
    // The accession does not resolve to a filing, so the reprocess fails and is
    // counted — and the entry is still pending, because only a clean run of the
    // extractor is allowed to clear it.
    const dl = new ExtractionDeadLetterRepo();
    await dl.record({
      extractor_id: "redemption",
      accession_number: "invalid-8k",
      section_name: "redemption",
      reason_code: "MODEL_INVALID_OUTPUT",
      detail: "response did not match schema",
      failed_extractor_version: "0.9.0",
      source_run_id: null,
    });

    const out = await new RetryDeadLettersTask().run({ extractorId: "redemption" } as never);
    expect(out.eligibleAccessions).toEqual(["invalid-8k"]);
    expect(out.resolved).toBe(0);
    expect(out.reprocessed).toBe(0);
    expect(out.failed).toBe(1);
    expect((await dl.get("redemption", "invalid-8k", "redemption"))?.status).toBe("pending");
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
