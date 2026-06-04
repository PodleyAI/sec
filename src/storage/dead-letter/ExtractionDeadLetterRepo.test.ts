/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
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
});
