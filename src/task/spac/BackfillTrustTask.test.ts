/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import {
  clearCurrentTrustRefreshForTesting,
  registerCurrentTrustRefresh,
} from "../../storage/spac/currentTrustRefresh";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { BackfillTrustTask } from "./BackfillTrustTask";

/**
 * A contributed refresh that reports what it was asked and in which mode.
 *
 * Which company fact IS a SPAC's current trust balance is the contributing
 * package's reading and is tested where that reading lives. What this file owes
 * is the sweep around it: every spac row reached, the dry-run and writing modes
 * kept apart, and the count taken from the answer rather than from the roster.
 */
function scriptedRefresh(changing: ReadonlySet<number>): {
  readonly wouldRefreshCalls: number[];
  readonly refreshCalls: number[];
} {
  const wouldRefreshCalls: number[] = [];
  const refreshCalls: number[] = [];
  registerCurrentTrustRefresh({
    wouldRefresh: async (cik) => {
      wouldRefreshCalls.push(cik);
      return changing.has(cik);
    },
    refresh: async (cik) => {
      refreshCalls.push(cik);
      return changing.has(cik);
    },
  });
  return { wouldRefreshCalls, refreshCalls };
}

async function seedSpac(cik: number): Promise<void> {
  await new SpacReportWriter().recordIpo({
    cik,
    accession_number: "0000-ipo",
    filing_date: "2021-01-15",
    form: "424B4",
    primary_document: "424.htm",
    ipo_proceeds: 200_000_000,
    trust_amount: 200_000_000,
    spac_tickers: [`T${cik}.U`],
  });
}

describe("BackfillTrustTask", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    clearCurrentTrustRefreshForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    clearCurrentTrustRefreshForTesting();
  });

  it("selects every known SPAC and counts the ones the refresh says changed", async () => {
    await seedSpac(91);
    await seedSpac(92);
    const calls = scriptedRefresh(new Set([91]));

    const live = await new BackfillTrustTask().execute({ dryRun: false });
    expect(live).toEqual({ selected: 2, updated: 1 });
    expect(calls.refreshCalls.sort()).toEqual([91, 92]);
    expect(calls.wouldRefreshCalls).toEqual([]);
  });

  it("asks the dry-run question under --dry-run, and never the writing one", async () => {
    await seedSpac(91);
    await seedSpac(92);
    const calls = scriptedRefresh(new Set([91]));

    const dry = await new BackfillTrustTask().execute({ dryRun: true });
    expect(dry).toEqual({ selected: 2, updated: 1 });
    expect(calls.wouldRefreshCalls.sort()).toEqual([91, 92]);
    expect(calls.refreshCalls).toEqual([]);
  });

  it("selects nothing, and reads no spac row, when no refresh is contributed", async () => {
    await seedSpac(91);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spacs = vi.spyOn(SpacRepo.prototype, "getAllSpacs");

    expect(await new BackfillTrustTask().execute({ dryRun: false })).toEqual({
      selected: 0,
      updated: 0,
    });
    // Reporting a selection this deployment cannot act on would be worse than
    // reporting none, and enumerating the roster to call nothing is pure cost.
    expect(spacs).not.toHaveBeenCalled();
    // Said once for the run, not once per SPAC — the answer is the same for
    // every one of them.
    expect(warn).toHaveBeenCalledTimes(1);

    spacs.mockRestore();
    warn.mockRestore();
  });
});
