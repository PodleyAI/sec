/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ListDeadLettersTask } from "./ListDeadLettersTask";

const OURS = 2100125;
const THEIRS = 2096755;

async function seedFiling(cik: number, accession: string): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik,
    accession_number: accession,
    form: "S-1",
    primary_doc: "s1.htm",
    file_number: "333-1",
    filing_date: "2026-01-15",
    acceptance_date: "2026-01-15T00:00:00.000Z",
    report_date: null,
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  });
}

async function recordPending(
  extractor_id: string,
  accession_number: string,
  section_name: string
): Promise<void> {
  await new ExtractionDeadLetterRepo().record({
    extractor_id,
    accession_number,
    section_name,
    reason_code: "UNVERIFIED_SOURCE_SPAN",
    detail: null,
    failed_extractor_version: "1.0.0",
    source_run_id: null,
  });
}

describe("ListDeadLettersTask", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => resetDependencyInjectionsForTesting());

  it("scopes pending entries to one issuer via filings, not the accession prefix", async () => {
    // Cambridge's 424 is 0001104659-26-011571 — Wolters Kluwer's CIK, not
    // 2100125. Grepping the listing for the issuer CIK would drop every row.
    await seedFiling(OURS, "0001104659-26-011571");
    await seedFiling(THEIRS, "0001104659-26-080405");
    await recordPending("424", "0001104659-26-011571", "offering-terms");
    await recordPending("424", "0001104659-26-080405", "offering-terms");

    const out = await new ListDeadLettersTask().run({ extractorId: "424", cik: OURS });
    expect(out.pending.map((r) => r.accession_number)).toEqual(["0001104659-26-011571"]);
    expect(out.eligibleCount).toBeNull();
  });

  it("lists every extractor for a CIK when the extractor id is omitted", async () => {
    await seedFiling(OURS, "0001104659-26-011571");
    await seedFiling(OURS, "0001104659-26-012751");
    await recordPending("424", "0001104659-26-011571", "offering-terms");
    await recordPending("redemption", "0001104659-26-012751", "redemption");
    await recordPending("S-1", "0000000000-26-000001", "Management");

    const out = await new ListDeadLettersTask().run({ cik: OURS });
    expect(out.pending.map((r) => `${r.extractor_id}:${r.accession_number}`).sort()).toEqual([
      "424:0001104659-26-011571",
      "redemption:0001104659-26-012751",
    ]);
  });

  it("counts only that CIK's eligible entries under --eligible", async () => {
    await seedFiling(OURS, "ours");
    await seedFiling(THEIRS, "theirs");
    // Both failed under a stale version, so without a CIK filter the count is 2.
    for (const accession of ["ours", "theirs"] as const) {
      await new ExtractionDeadLetterRepo().record({
        extractor_id: "S-1",
        accession_number: accession,
        section_name: "Management",
        reason_code: "UNVERIFIED_SOURCE_SPAN",
        detail: null,
        failed_extractor_version: "0.9.0",
        source_run_id: null,
      });
    }

    const out = await new ListDeadLettersTask().run({
      extractorId: "S-1",
      cik: OURS,
      eligible: true,
    });
    expect(out.pending).toEqual([]);
    expect(out.eligibleCount).toBe(1);
  });

  it("counts eligible entries across every extractor for a CIK when the extractor id is omitted", async () => {
    // Eligibility is per-extractor (each has its own current version). A CIK
    // listing that refused to run without an id left the operator counting
    // S-1, 424, and redemption by hand.
    await seedFiling(OURS, "s1-acc");
    await seedFiling(OURS, "424-acc");
    await seedFiling(OURS, "red-acc");
    await seedFiling(THEIRS, "other-acc");
    const record = async (
      extractor_id: string,
      accession_number: string,
      failed_extractor_version: string
    ): Promise<void> =>
      new ExtractionDeadLetterRepo().record({
        extractor_id,
        accession_number,
        section_name: extractor_id,
        reason_code: "UNVERIFIED_SOURCE_SPAN",
        detail: null,
        failed_extractor_version,
        source_run_id: null,
      });
    await record("S-1", "s1-acc", "0.9.0");
    await record("424", "424-acc", "0.9.0");
    await record("redemption", "red-acc", "1.0.0");
    await record("S-1", "other-acc", "0.9.0");

    const out = await new ListDeadLettersTask().run({ cik: OURS, eligible: true });
    expect(out.pending).toEqual([]);
    expect(out.eligibleCount).toBe(2);
    expect(out.eligibleByExtractor).toEqual([
      { extractor_id: "424", count: 1 },
      { extractor_id: "S-1", count: 1 },
    ]);
  });
});
