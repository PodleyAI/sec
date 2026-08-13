/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ExtractionDeadLetterRepo } from "./ExtractionDeadLetterRepo";

describe("ExtractionDeadLetterRepo", () => {
  let repo: ExtractionDeadLetterRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = new ExtractionDeadLetterRepo();
  });

  it("records a failure, increments attempts on re-record, and resolves", async () => {
    await repo.record({
      extractor_id: "S-1",
      accession_number: "acc1",
      section_name: "Management",
      reason_code: "MODEL_EMPTY",
      detail: "no rows",
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });
    let row = await repo.get("S-1", "acc1", "Management");
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(1);

    await repo.record({
      extractor_id: "S-1",
      accession_number: "acc1",
      section_name: "Management",
      reason_code: "MODEL_EMPTY",
      detail: "still no rows",
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });
    row = await repo.get("S-1", "acc1", "Management");
    expect(row?.attempts).toBe(2);

    await repo.markResolved("S-1", "acc1", "Management");
    expect((await repo.get("S-1", "acc1", "Management"))?.status).toBe("resolved");
  });

  it("restarts attempts when the reason code or version changes", async () => {
    // `attempts` gates the bounded same-version retry, a decision scoped to ONE
    // (reason_code, version) pair — but the row is keyed by SECTION, so a
    // lifetime counter is shared across every failure the section ever had. A
    // section that burned three attempts on an unrelated code under an older
    // version must still arrive at its first bounded-retry failure with a full
    // budget, or the retry path is inert for exactly the entries it exists for.
    const record = async (
      reason_code: "UNVERIFIED_SOURCE_SPAN" | "MIXED_CAPTION_SHAPE",
      failed_extractor_version: string
    ): Promise<void> =>
      repo.record({
        extractor_id: "S-1",
        accession_number: "history",
        section_name: "Risk Factors",
        reason_code,
        detail: null,
        failed_extractor_version,
        source_run_id: null,
      });

    await record("UNVERIFIED_SOURCE_SPAN", "1.0.0");
    await record("UNVERIFIED_SOURCE_SPAN", "1.0.0");
    await record("UNVERIFIED_SOURCE_SPAN", "1.0.0");
    expect((await repo.get("S-1", "history", "Risk Factors"))?.attempts).toBe(3);

    // First-ever MIXED_CAPTION_SHAPE, under a new version: a fresh streak.
    await record("MIXED_CAPTION_SHAPE", "1.1.0");
    expect((await repo.get("S-1", "history", "Risk Factors"))?.attempts).toBe(1);
    expect((await repo.listEligible("S-1", "1.1.0")).map((r) => r.accession_number)).toEqual([
      "history",
    ]);
  });

  it("zeroes attempts on resolve so a later failure starts a fresh streak", async () => {
    const record = async (): Promise<void> =>
      repo.record({
        extractor_id: "S-1",
        accession_number: "flapping",
        section_name: "Risk Factors",
        reason_code: "MIXED_CAPTION_SHAPE",
        detail: null,
        failed_extractor_version: "1.0.0",
        source_run_id: null,
      });

    await record();
    await repo.markResolved("S-1", "flapping", "Risk Factors");
    expect((await repo.get("S-1", "flapping", "Risk Factors"))?.attempts).toBe(0);
    // A clean run ended the streak, so the next failure is attempt one — not a
    // continuation of a run that has since been shown to recover.
    await record();
    expect((await repo.get("S-1", "flapping", "Risk Factors"))?.attempts).toBe(1);
  });

  it("lists pending entries eligible under a newer version", async () => {
    await repo.record({
      extractor_id: "S-1",
      accession_number: "old",
      section_name: "Management",
      reason_code: "MODEL_INVALID_OUTPUT",
      detail: null,
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });
    await repo.record({
      extractor_id: "S-1",
      accession_number: "current",
      section_name: "Management",
      reason_code: "MODEL_INVALID_OUTPUT",
      detail: null,
      failed_extractor_version: "1.1.0",
      source_run_id: null,
    });
    const eligible = await repo.listEligible("S-1", "1.1.0");
    expect(eligible.map((r) => r.accession_number)).toEqual(["old"]);
    expect(await repo.countEligible("S-1", "1.1.0")).toBe(1);
  });

  it("keeps MODEL_RESOLUTION_ERROR entries eligible under the same version", async () => {
    // A model/provider-availability failure recovers by re-running once the model
    // is registered — no version bump — so it must stay eligible at the current
    // version, unlike a version-fixable output bug.
    await repo.record({
      extractor_id: "S-1",
      accession_number: "model-err",
      section_name: "Management",
      reason_code: "MODEL_RESOLUTION_ERROR",
      detail: "model not registered",
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });
    await repo.record({
      extractor_id: "S-1",
      accession_number: "output-bug",
      section_name: "Management",
      reason_code: "MODEL_INVALID_OUTPUT",
      detail: null,
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });

    // Same version: only the model-error entry is eligible.
    const eligible = await repo.listEligible("S-1", "1.0.0");
    expect(eligible.map((r) => r.accession_number)).toEqual(["model-err"]);
    expect(await repo.countEligible("S-1", "1.0.0")).toBe(1);
  });

  it("keeps RATE_LIMITED entries eligible under the same version", async () => {
    // The section never ran: the provider throttled it until its wait budget
    // was spent. Nothing about the extractor needs fixing, so gating the retry
    // on a version bump would ask for a code change to recover from a quota
    // window that has since moved on.
    await repo.record({
      extractor_id: "S-1",
      accession_number: "throttled",
      section_name: "Management",
      reason_code: "RATE_LIMITED",
      detail: "Provider throttle did not clear after 5 waits: HTTP 429",
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });
    await repo.record({
      extractor_id: "S-1",
      accession_number: "output-bug",
      section_name: "Management",
      reason_code: "MODEL_INVALID_OUTPUT",
      detail: null,
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });

    const eligible = await repo.listEligible("S-1", "1.0.0");
    expect(eligible.map((r) => r.accession_number)).toEqual(["throttled"]);
    expect(await repo.countEligible("S-1", "1.0.0")).toBe(1);
  });

  it("keeps MIXED_CAPTION_SHAPE eligible under the same version, but only for a bounded number of attempts", async () => {
    // A mixed caption shape is a property of one generation, not of the
    // extractor: the model echoed a category heading back as a row, and the
    // next call usually does not. Gating that behind a version bump asks for a
    // code change to recover from a dice roll, so it retries under the same
    // version.
    //
    // The bound is the other half. Unlike a provider outage, a genuinely
    // ambiguous section never clears — an unbounded same-version retry would
    // leave an entry no operator can resolve while re-paying the AI cost of the
    // largest section in the filing on every sweep, forever.
    const record = async (): Promise<void> =>
      repo.record({
        extractor_id: "S-1",
        accession_number: "mixed",
        section_name: "Risk Factors",
        reason_code: "MIXED_CAPTION_SHAPE",
        detail: "4 of 20 rows have no sentence-ending punctuation",
        failed_extractor_version: "1.0.0",
        source_run_id: null,
      });

    await record();
    expect((await repo.get("S-1", "mixed", "Risk Factors"))?.attempts).toBe(1);
    expect(await repo.countEligible("S-1", "1.0.0")).toBe(1);

    await record();
    await record();
    // Three recorded attempts: the budget is spent, so it falls back to the
    // ordinary version gate — fix the prompt or the heuristic, bump, retry.
    expect((await repo.get("S-1", "mixed", "Risk Factors"))?.attempts).toBe(3);
    expect(await repo.countEligible("S-1", "1.0.0")).toBe(0);
    // Still recoverable the version-gated way.
    expect(await repo.countEligible("S-1", "1.1.0")).toBe(1);
  });
});
