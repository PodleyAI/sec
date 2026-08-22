/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { planSpacTimeline } from "./planSpacTimeline";

async function addFiling(args: {
  readonly cik: number;
  readonly accession: string;
  readonly form: string;
  readonly date: string;
}): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik: args.cik,
    accession_number: args.accession,
    filing_date: args.date,
    report_date: null,
    acceptance_date: "2025-01-01T12:00:00.000Z",
    form: args.form,
    file_number: null,
    film_number: null,
    primary_doc: "doc.htm",
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  } as never);
}

const NONE = { kind: "none" } as const;

describe("planSpacTimeline", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("orders by filing date, then accession", async () => {
    await addFiling({ cik: 1, accession: "0000000000-25-000003", form: "8-K", date: "2025-03-01" });
    await addFiling({ cik: 1, accession: "0000000000-25-000002", form: "S-1", date: "2025-01-01" });
    await addFiling({
      cik: 1,
      accession: "0000000000-25-000001",
      form: "S-1/A",
      date: "2025-01-01",
    });

    const plan = await planSpacTimeline({ cik: 1, force: NONE });
    expect(plan.timeline.map((f) => f.accession_number)).toEqual([
      "0000000000-25-000001",
      "0000000000-25-000002",
      "0000000000-25-000003",
    ]);
    expect(plan.firstDate).toBe("2025-01-01");
    expect(plan.lastDate).toBe("2025-03-01");
  });

  it("sorts a filing with no date last so it can never precede the S-1 that mints the row", async () => {
    // `filings.filing_date` is NOT NULL in storage, so this shape only reaches
    // the planner from a backend that lost the value — which is exactly when
    // ordering it FIRST would replay an 8-K ahead of the registration statement
    // and silently drop its milestones.
    await addFiling({ cik: 2, accession: "0000000000-25-000009", form: "8-K", date: "" });
    await addFiling({ cik: 2, accession: "0000000000-25-000010", form: "S-1", date: "2025-05-01" });
    const plan = await planSpacTimeline({ cik: 2, force: NONE });
    expect(plan.timeline.map((f) => f.accession_number)).toEqual([
      "0000000000-25-000010",
      "0000000000-25-000009",
    ]);
  });

  it("drops forms no extractor handles", async () => {
    await addFiling({ cik: 3, accession: "0000000000-25-000011", form: "S-1", date: "2025-01-01" });
    await addFiling({
      cik: 3,
      accession: "0000000000-25-000012",
      form: "SC 13G",
      date: "2025-02-01",
    });
    const plan = await planSpacTimeline({ cik: 3, force: NONE });
    expect(plan.timeline.map((f) => f.form)).toEqual(["S-1"]);
  });

  it("holds gated filings back while the issuer has no spac row", async () => {
    await addFiling({ cik: 4, accession: "0000000000-25-000013", form: "S-1", date: "2025-01-01" });
    await addFiling({ cik: 4, accession: "0000000000-25-000014", form: "8-K", date: "2025-02-01" });
    const plan = await planSpacTimeline({ cik: 4, force: NONE });
    expect(plan.hasSpacRow).toBe(false);
    // The 8-K's handler would no-op and record success, dropping its milestones
    // with nothing left to re-select it; the caller's repair pass takes it once
    // the S-1 has minted the row.
    expect(plan.toProcess.map((f) => f.form)).toEqual(["S-1"]);
    expect(plan.skipped).toBe(1);
  });

  it("applies an inclusive filing-date floor but keeps a filing with no date", async () => {
    await addFiling({ cik: 5, accession: "0000000000-25-000015", form: "S-1", date: "2024-01-01" });
    await addFiling({ cik: 5, accession: "0000000000-25-000016", form: "S-1", date: "2025-06-01" });
    await addFiling({ cik: 5, accession: "0000000000-25-000017", form: "S-1", date: "" });
    const plan = await planSpacTimeline({ cik: 5, force: NONE, filedOnOrAfter: "2025-01-01" });
    // Dropping a dateless filing would hide work that has no date to compare.
    expect(plan.toProcess.map((f) => f.accession_number).sort()).toEqual([
      "0000000000-25-000016",
      "0000000000-25-000017",
    ]);
  });

  it("returns an empty plan for an issuer with no processable filings", async () => {
    const plan = await planSpacTimeline({ cik: 999, force: NONE });
    expect(plan.timeline).toHaveLength(0);
    expect(plan.firstDate).toBe("");
    expect(plan.activeVersions.size).toBe(0);
  });
});
