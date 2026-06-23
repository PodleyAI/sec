/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SpacRepo } from "./SpacRepo";
import { SpacReportWriter } from "./SpacReportWriter";
import { CHANGE_LOG_REPOSITORY_TOKEN } from "../change-tracking/ChangeLogSchema";

describe("SpacReportWriter", () => {
  let repo: SpacRepo;
  let writer: SpacReportWriter;
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacRepo();
    writer = new SpacReportWriter();
  });

  it("records registration then ipo and rolls the row forward", async () => {
    await writer.recordRegistration({
      cik: 5,
      accession_number: "0000-reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Foo SPAC",
      spac_sic: 6770,
    });
    let row = await repo.getSpac(5);
    expect(row?.status).toBe("registered");
    expect(row?.registration_date).toBe("2020-12-01");

    await writer.recordIpo({
      cik: 5,
      accession_number: "0000-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 200_000_000,
      spac_tickers: ["FOO.U", "FOO", "FOO.WS"],
    });
    row = await repo.getSpac(5);
    expect(row?.status).toBe("ipo");
    expect(row?.ipo_date).toBe("2021-01-15");
    expect(row?.ipo_proceeds).toBe(200_000_000);
    expect(JSON.parse(row!.spac_tickers!)).toEqual(["FOO.U", "FOO", "FOO.WS"]);
    expect(row?.spac_name).toBe("Foo SPAC"); // merged, not clobbered by the IPO filing
  });

  it("an out-of-order older registration replay does not regress the row", async () => {
    await writer.recordIpo({
      cik: 6,
      accession_number: "0000-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 200_000_000,
      spac_tickers: ["BAR.U"],
    });
    const before = await repo.getSpac(6);
    expect(before?.as_of).toBe("2021-01-15");

    await writer.recordRegistration({
      cik: 6,
      accession_number: "0000-reg",
      filing_date: "2020-12-01", // older
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Bar SPAC",
      spac_sic: 6770,
    });
    const after = await repo.getSpac(6);
    expect(after?.as_of).toBe("2021-01-15"); // anchor not regressed
    expect(after?.registration_date).toBe("2020-12-01"); // but the event date still rolls in
    expect(after?.ipo_proceeds).toBe(200_000_000); // IPO scalars preserved
    expect(after?.spac_name).toBe("Bar SPAC"); // name was null, fills from the older filing
  });

  it("writes history snapshots and ChangeLog rows on change", async () => {
    await writer.recordRegistration({
      cik: 7,
      accession_number: "0000-reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Baz SPAC",
      spac_sic: 6770,
    });
    const history = await repo.getHistory(7);
    expect(history.length).toBe(1);
    expect(history[0].valid_to).toBeNull();
    const changeLog = globalServiceRegistry.get(CHANGE_LOG_REPOSITORY_TOKEN);
    const changes = (await changeLog.query({ entity_type: "spac", entity_id: "7" })) || [];
    expect(changes.length).toBeGreaterThan(0);
  });
});
