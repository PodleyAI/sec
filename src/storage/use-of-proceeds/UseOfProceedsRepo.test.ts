/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { UseOfProceedsRepo } from "./UseOfProceedsRepo";

describe("UseOfProceedsRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("saves line items and lists them by accession; clear removes them", async () => {
    const repo = new UseOfProceedsRepo();
    const row = {
      extractor_id: "S-1",
      accession_number: "0000000000-26-000001",
      line_index: 0,
      cik: 1018724,
      purpose: "working capital",
      amount: 50000000,
      percent: 60,
      note: null,
      confidence: 0.8,
      source_span: "working capital",
      created_at: new Date().toISOString(),
    };
    await repo.save(row);
    const got = await repo.queryByAccession("0000000000-26-000001");
    expect(got[0].purpose).toBe("working capital");
    await repo.clear("0000000000-26-000001");
    expect(await repo.queryByAccession("0000000000-26-000001")).toHaveLength(0);
  });
});
