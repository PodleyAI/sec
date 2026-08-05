/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ENTITY_HISTORY_REPOSITORY_TOKEN } from "../../storage/entity/EntityHistorySchema";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../../storage/spac/SpacCandidateSchema";
import { IdentifySpacsTask } from "./IdentifySpacsTask";

const ctx = {
  signal: new AbortController().signal,
  updateProgress: () => {},
} as unknown as IExecuteContext;

async function addEntity(cik: number, name: string, sic: number | null): Promise<void> {
  await globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN).put({
    cik,
    name,
    sic,
    type: null,
    ein: null,
    description: null,
    website: null,
    investor_website: null,
    category: null,
    fiscal_year: null,
    state_incorporation: null,
    state_incorporation_desc: null,
  });
}

async function addRegistration(cik: number, form: string, filing_date: string): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik,
    accession_number: `0000000000-00-${String(cik).slice(-6).padStart(6, "0")}`,
    filing_date,
    report_date: null,
    acceptance_date: `${filing_date}T12:00:00.000Z`,
    form,
    file_number: null,
    film_number: null,
    primary_doc: "doc.htm",
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  });
}

async function addFormerName(
  cik: number,
  name: string,
  valid_from: string,
  valid_to: string | null
): Promise<void> {
  await globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN).put({
    cik,
    valid_from,
    valid_to,
    name,
    type: null,
    sic: null,
    ein: null,
    description: null,
    website: null,
    investor_website: null,
    category: null,
    fiscal_year: null,
    state_incorporation: null,
    state_incorporation_desc: null,
    change_source: "SUBMISSIONS_FORMER_NAMES",
    change_date: "2026-08-01T00:00:00.000Z",
  });
}

const candidates = async () =>
  (await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).getAll()) ?? [];

describe("IdentifySpacsTask", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
  });

  it("identifies live SPACs, de-SPACs, and shells, and ignores operating companies", async () => {
    await addEntity(1, "Yuanxiang Acquisition Corp.", 6770);
    await addRegistration(1, "F-1", "2025-09-17");

    await addEntity(2, "DraftKings Holdings Inc.", 7990);
    await addRegistration(2, "S-1", "2019-04-11");
    await addFormerName(2, "Diamond Eagle Acquisition Corp", "2019-01-01", "2020-04-23");

    await addEntity(3, "Global Employment Holdings, Inc.", 7363);
    await addRegistration(3, "S-1", "2006-05-01");
    await addFormerName(3, "R&R ACQUISITION I, INC", "2006-01-19", "2006-03-28");

    await addEntity(4, "Apple Inc.", 3571);
    await addRegistration(4, "S-1", "1980-12-12");

    const out = await new IdentifySpacsTask().execute({ full: true }, ctx);

    expect(out).toMatchObject({ success: true, identified: 3, high: 2, low: 1, since: null });
    const byCik = new Map((await candidates()).map((r) => [r.cik, r]));
    expect(byCik.get(1)).toMatchObject({ confidence: "high", first_reg_form: "F-1" });
    expect(byCik.get(2)).toMatchObject({
      confidence: "high",
      signal_renamed_from: "Diamond Eagle Acquisition Corp",
      reg_while_spac_named: true,
    });
    expect(byCik.get(3)).toMatchObject({ confidence: "low", reg_while_spac_named: false });
    expect(byCik.has(4)).toBe(false);
  });

  it("is idempotent — a second full scan neither duplicates nor drops rows", async () => {
    await addEntity(1, "Yuanxiang Acquisition Corp.", 6770);
    await addRegistration(1, "F-1", "2025-09-17");

    const task = new IdentifySpacsTask();
    await task.execute({ full: true }, ctx);
    const first = await candidates();
    await task.execute({ full: true }, ctx);
    const second = await candidates();

    expect(second).toHaveLength(first.length);
    expect(second[0].cik).toBe(1);
  });

  it("prunes a CIK that no longer matches any signal", async () => {
    await addEntity(1, "Yuanxiang Acquisition Corp.", 6770);
    await addRegistration(1, "F-1", "2025-09-17");
    await new IdentifySpacsTask().execute({ full: true }, ctx);
    expect(await candidates()).toHaveLength(1);

    // The company renames and is recoded with no blank-check history left
    // behind — nothing about it says SPAC any more.
    await addEntity(1, "Some Operating Co", 3711);
    const out = await new IdentifySpacsTask().execute({ full: true }, ctx);

    expect(out.identified).toBe(0);
    expect(await candidates()).toHaveLength(0);
  });

  it("incremental mode looks only at CIKs whose submissions changed since the last run", async () => {
    const processed = globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN);
    await addEntity(1, "Old Acquisition Corp", 6770);
    await addRegistration(1, "S-1", "2020-01-01");
    await processed.put({ cik: 1, last_processed: "2020-01-02", success: true });
    await new IdentifySpacsTask().execute({ full: true }, ctx);

    // A brand-new SPAC lands today; the old one has not been touched since.
    await addEntity(2, "New Acquisition Corp", 6770);
    await addRegistration(2, "S-1", "2026-08-02");
    const today = new Date().toISOString().slice(0, 10);
    await processed.put({ cik: 2, last_processed: today, success: true });

    const out = await new IdentifySpacsTask().execute({}, ctx);

    expect(out.since).not.toBeNull();
    // Only CIK 2 was rescanned...
    expect(out.identified).toBe(1);
    // ...and CIK 1's existing row survived untouched.
    expect((await candidates()).map((r) => r.cik).sort()).toEqual([1, 2]);
  });

  it("falls back to a full scan when the table is empty", async () => {
    await addEntity(1, "Yuanxiang Acquisition Corp.", 6770);
    const out = await new IdentifySpacsTask().execute({}, ctx);
    expect(out.since).toBeNull();
    expect(out.identified).toBe(1);
  });
});
