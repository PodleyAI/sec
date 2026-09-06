/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ADV_ADVISER_REPOSITORY_TOKEN } from "../../storage/adv/AdvAdviserSchema";
import { ADV_ROW_REPOSITORY_TOKEN } from "../../storage/adv/AdvRowSchema";
import { advArchiveFolder } from "./advArchive";
import { IngestAdvSnapshotTask } from "./IngestAdvSnapshotTask";

const BASE_CSV = [
  "FilingID,DateSubmitted,1A,1B1,1D,1E1,1F1-City,1F1-State,1F1-Country,5F2c",
  '1001,3/14/2026,"Acme Capital Management, LP",Acme Capital,801-12345,110001,Boston,MA,United States,"1,250,000,000"',
  "1002,3/15/2026,Beta Advisors LLC,,801-99999,110002,Austin,TX,United States,",
].join("\n");

const SCHEDULE_CSV = [
  "FilingID,Fund Name,Fund Type",
  "1001,Acme Growth Fund I,Venture Capital Fund",
].join("\n");

describe("IngestAdvSnapshotTask", () => {
  let dir: string;

  /** Extracts one archive's members into the folder that snapshot owns. */
  const extract = (snapshot: string, members: Record<string, string>): void => {
    const folder = join(dir, advArchiveFolder(snapshot));
    mkdirSync(folder, { recursive: true });
    for (const [name, body] of Object.entries(members)) {
      writeFileSync(join(folder, name), body);
    }
  };

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    dir = mkdtempSync(join(tmpdir(), "sec-adv-"));
    extract("2026-06", { "IA_ADV_Base_A.csv": BASE_CSV, "IA_Schedule_D_7B1.csv": SCHEDULE_CSV });
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, dir);
    await globalServiceRegistry.get(ADV_ADVISER_REPOSITORY_TOKEN).setupDatabase();
    await globalServiceRegistry.get(ADV_ROW_REPOSITORY_TOKEN).setupDatabase();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetDependencyInjectionsForTesting();
  });

  it("lands every member as adv_row, and the base filing as typed advisers", async () => {
    const out = await new IngestAdvSnapshotTask().run({ snapshot: "2026-06" });
    expect(out).toMatchObject({ success: true, tables: 2, rows: 3, advisers: 2 });

    const advisers = globalServiceRegistry.get(ADV_ADVISER_REPOSITORY_TOKEN);
    const acme = await advisers.get({ snapshot: "2026-06", crd_number: "110001" });
    expect(acme?.legal_name).toBe("Acme Capital Management, LP");
    expect(acme?.sec_file_number).toBe("801-12345");
    expect(acme?.main_office_state).toBe("MA");
    // The dollar signs and commas ADV writes are stripped, or the number is a
    // string that no `--min-aum` comparison can use.
    expect(acme?.regulatory_aum).toBe(1_250_000_000);
    expect(acme?.date_submitted).toBe("2026-03-14");

    const beta = await advisers.get({ snapshot: "2026-06", crd_number: "110002" });
    // An empty CSV cell is absence, not an empty string or a zero.
    expect(beta?.regulatory_aum).toBeNull();
    expect(beta?.primary_business_name).toBeNull();
  });

  it("keeps every column of the untyped members, keyed by their own header", async () => {
    await new IngestAdvSnapshotTask().run({ snapshot: "2026-06" });

    const rows = globalServiceRegistry.get(ADV_ROW_REPOSITORY_TOKEN);
    const schedule =
      (await rows.query({ snapshot: "2026-06", table_name: "IA_Schedule_D_7B1" })) ?? [];
    expect(schedule).toHaveLength(1);
    expect(JSON.parse(schedule[0]!.data)).toEqual({
      FilingID: "1001",
      "Fund Name": "Acme Growth Fund I",
      "Fund Type": "Venture Capital Fund",
    });
  });

  it("numbers rows within their own member, as the primary key describes", async () => {
    await new IngestAdvSnapshotTask().run({ snapshot: "2026-06" });

    const rows = globalServiceRegistry.get(ADV_ROW_REPOSITORY_TOKEN);
    const base = (await rows.query({ snapshot: "2026-06", table_name: "IA_ADV_Base_A" })) ?? [];
    const schedule =
      (await rows.query({ snapshot: "2026-06", table_name: "IA_Schedule_D_7B1" })) ?? [];

    // Each member restarts at 0 — `table_name` is already in the primary key,
    // so a counter running across members buys no uniqueness and instead makes
    // every later member's keys a function of the earlier members' lengths.
    expect(base.map((row) => row.row_index).sort()).toEqual([0, 1]);
    expect(schedule.map((row) => row.row_index)).toEqual([0]);
  });

  it("reads only the snapshot's own folder, so one period cannot be stamped with another's rows", async () => {
    // The cumulative archive on disk beside a monthly one is the shape that
    // mislabelled thirteen years of filings: both used to extract into `adv/`.
    extract("2011-2024", { "IA_ADV_Base_A.csv": BASE_CSV, "IA_Old_Schedule.csv": SCHEDULE_CSV });

    const out = await new IngestAdvSnapshotTask().run({ snapshot: "2026-06" });
    expect(out.tables).toBe(2);

    const rows = globalServiceRegistry.get(ADV_ROW_REPOSITORY_TOKEN);
    const stamped = (await rows.query({ snapshot: "2026-06" })) ?? [];
    expect(stamped.map((row) => row.table_name)).not.toContain("IA_Old_Schedule");
  });

  it("replaces a snapshot on re-ingest instead of leaving the longer run's tail behind", async () => {
    await new IngestAdvSnapshotTask().run({ snapshot: "2026-06" });

    // The re-published archive is shorter — the case a plain upsert cannot
    // handle, since the rows it does not write are the ones that must go.
    extract("2026-06", {
      "IA_ADV_Base_A.csv": BASE_CSV.split("\n").slice(0, 2).join("\n"),
      "IA_Schedule_D_7B1.csv": SCHEDULE_CSV,
    });
    const second = await new IngestAdvSnapshotTask().run({ snapshot: "2026-06" });
    expect(second).toMatchObject({ rows: 2, advisers: 1 });

    const rows = globalServiceRegistry.get(ADV_ROW_REPOSITORY_TOKEN);
    expect((await rows.getAll()) ?? []).toHaveLength(2);
    const advisers = globalServiceRegistry.get(ADV_ADVISER_REPOSITORY_TOKEN);
    expect(await advisers.get({ snapshot: "2026-06", crd_number: "110002" })).toBeUndefined();
  });

  it("leaves the other snapshots alone when one is re-ingested", async () => {
    extract("2011-2024", { "IA_ADV_Base_A.csv": BASE_CSV });
    await new IngestAdvSnapshotTask().run({ snapshot: "2011-2024" });
    await new IngestAdvSnapshotTask().run({ snapshot: "2026-06" });
    await new IngestAdvSnapshotTask().run({ snapshot: "2026-06" });

    const rows = globalServiceRegistry.get(ADV_ROW_REPOSITORY_TOKEN);
    expect((await rows.query({ snapshot: "2011-2024" })) ?? []).toHaveLength(2);
    expect((await rows.query({ snapshot: "2026-06" })) ?? []).toHaveLength(3);
  });

  it("says what to run when the archive was never downloaded", async () => {
    await expect(new IngestAdvSnapshotTask().run({ snapshot: "2026-07" })).rejects.toThrow(
      /sec update adv --period 2026-07/
    );
    await expect(new IngestAdvSnapshotTask().run({ snapshot: "2011-2024" })).rejects.toThrow(
      /sec load download adv/
    );
  });
});
