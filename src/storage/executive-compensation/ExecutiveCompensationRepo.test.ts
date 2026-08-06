/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ExecutiveCompensationRepo } from "./ExecutiveCompensationRepo";
import type { ExecutiveCompensation } from "./ExecutiveCompensationSchema";

const EMPTY = {
  observation_id: null,
  principal_position: null,
  fiscal_year: null,
  salary: null,
  bonus: null,
  stock_awards: null,
  option_awards: null,
  non_equity_incentive: null,
  pension_and_nqdc: null,
  all_other_compensation: null,
  total: null,
  footnote: null,
} satisfies Omit<ExecutiveCompensation, "accession_number" | "extractor_id" | "row_index">;

describe("ExecutiveCompensationRepo", () => {
  let repo: ExecutiveCompensationRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = new ExecutiveCompensationRepo();
  });

  it("saves, queries by accession, and clears", async () => {
    await repo.save({
      ...EMPTY,
      accession_number: "0000000000-26-000001",
      extractor_id: "S-1",
      row_index: 3,
      observation_id: 100,
      principal_position: "Chief Executive Officer",
      fiscal_year: 2025,
      salary: 612_500,
      bonus: 425_000,
      option_awards: 3_180_400,
      all_other_compensation: 12_300,
      total: 4_230_200,
      footnote: "Represents 401(k) matching contributions.",
    });
    const rows = await repo.queryByAccession("0000000000-26-000001");
    expect(rows).toHaveLength(1);
    expect(rows[0].fiscal_year).toBe(2025);
    expect(rows[0].total).toBe(4_230_200);

    await repo.clear("0000000000-26-000001");
    expect(await repo.queryByAccession("0000000000-26-000001")).toHaveLength(0);
  });

  it("keeps one row per fiscal year against a single person observation", async () => {
    // Two table rows for the same officer are two compensation facts but one
    // mention of that person — the row key and the observation FK are separate.
    for (const [i, year] of [2025, 2024].entries()) {
      await repo.save({
        ...EMPTY,
        accession_number: "a",
        extractor_id: "S-1",
        row_index: i,
        observation_id: 100,
        fiscal_year: year,
        salary: year === 2025 ? 612_500 : 570_000,
      });
    }
    const rows = await repo.queryByAccession("a");
    expect(rows.map((r) => r.fiscal_year).sort()).toEqual([2024, 2025]);
    expect(new Set(rows.map((r) => r.observation_id)).size).toBe(1);
  });

  it("tolerates the columns a scaled-disclosure filing omits", async () => {
    await repo.save({
      ...EMPTY,
      accession_number: "b",
      extractor_id: "S-1",
      row_index: 0,
    });
    const rows = await repo.queryByAccession("b");
    expect(rows[0].non_equity_incentive).toBeNull();
    expect(rows[0].pension_and_nqdc).toBeNull();
    expect(rows[0].salary).toBeNull();
  });
});
