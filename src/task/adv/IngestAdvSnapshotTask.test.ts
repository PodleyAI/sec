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

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    dir = mkdtempSync(join(tmpdir(), "sec-adv-"));
    const folder = join(dir, "adv");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "IA_ADV_Base_A.csv"), BASE_CSV);
    writeFileSync(join(folder, "IA_Schedule_D_7B1.csv"), SCHEDULE_CSV);
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

  it("numbers rows across members, so two members cannot overwrite each other", async () => {
    await new IngestAdvSnapshotTask().run({ snapshot: "2026-06" });

    const rows = globalServiceRegistry.get(ADV_ROW_REPOSITORY_TOKEN);
    const all = (await rows.getAll()) ?? [];
    expect(all).toHaveLength(3);
    expect(new Set(all.map((row) => row.row_index)).size).toBe(3);
  });

  it("says what to run when the archive was never downloaded", async () => {
    rmSync(join(dir, "adv"), { recursive: true, force: true });
    await expect(new IngestAdvSnapshotTask().run({ snapshot: "2026-06" })).rejects.toThrow();
  });
});
