/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { setupAllDatabases } from "../config/setupAllDatabases";
import { FamilyDescriptionRepo } from "../storage/canonical/FamilyDescriptionRepo";
import { SpacRepo } from "../storage/spac/SpacRepo";
import { SpacReportWriter } from "../storage/spac/SpacReportWriter";
import { normalizeUnderwriterFamilyName } from "../resolver/UnderwriterFamilyResolver";
import {
  importFamilyDescriptions,
  importSpacEditorial,
  parseEditorialCsv,
} from "./editorialImport";

const SPAC_CSV =
  "cik,name,url_spac,url_sponsor,details\n" +
  '1841425,CENAQ Energy Corp.,,https://sponsor.example.com,"{""unit_price"":10,""warrant_ratio"":""1:1""}"\n' +
  "1802749,GigCapital3,https://www.gigcapitalglobal.com/entity/gigcapital3/,https://gigcapitalglobal.com/,\n";

const FAMILY_CSV =
  "family_kind,name,description\n" +
  'underwriter-family,Chardan,"Chardan is a SPAC-focused investment bank."\n' +
  "sponsor-family,Churchill Capital,Klein-family sponsor group.\n";

describe("parseEditorialCsv", () => {
  it("parses the spac editorial format", () => {
    const parsed = parseEditorialCsv(SPAC_CSV);
    expect(parsed.kind).toBe("spac");
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.spacRows).toHaveLength(2);
    expect(parsed.spacRows[0]).toMatchObject({
      cik: 1841425,
      url_sponsor: "https://sponsor.example.com",
      url_spac: undefined,
    });
    expect(JSON.parse(parsed.spacRows[0].details as string)).toEqual({
      unit_price: 10,
      warrant_ratio: "1:1",
    });
  });

  it("parses the family description format", () => {
    const parsed = parseEditorialCsv(FAMILY_CSV);
    expect(parsed.kind).toBe("family");
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.familyRows).toHaveLength(2);
    expect(parsed.familyRows[0].family_kind).toBe("underwriter-family");
  });

  it("rejects invalid rows with line-numbered errors", () => {
    const parsed = parseEditorialCsv(
      "cik,name,url_spac,url_sponsor,details\n" +
        "notacik,Bad,,,\n" +
        "5,NoValues,,,\n" +
        "6,BadUrl,ftp://x,,\n" +
        '7,BadJson,,,"[1,2]"\n' +
        "8,Good,,https://ok.example.com,\n"
    );
    expect(parsed.spacRows).toHaveLength(1);
    expect(parsed.spacRows[0].cik).toBe(8);
    expect(parsed.errors).toHaveLength(4);
    expect(parsed.errors[0]).toContain("line 2");
    expect(parsed.errors[3]).toContain("line 5");
  });

  it("rejects unknown family kinds", () => {
    const parsed = parseEditorialCsv(
      "family_kind,name,description\nleadership,Someone,text\n"
    );
    expect(parsed.familyRows).toHaveLength(0);
    expect(parsed.errors[0]).toContain("unknown family_kind");
  });

  it("errors on an unrecognized header", () => {
    const parsed = parseEditorialCsv("foo,bar\n1,2\n");
    expect(parsed.errors[0]).toContain("unrecognized header");
  });
});

describe("importSpacEditorial", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  async function seedSpac(cik: number): Promise<void> {
    await new SpacReportWriter().recordRegistration({
      cik,
      accession_number: `${cik}-reg`,
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Editorial SPAC Inc.",
      spac_sic: 6770,
    });
  }

  it("skips CIKs with no spac row by default and creates them with createMissing", async () => {
    await seedSpac(10);
    const rows = parseEditorialCsv(
      "cik,name,url_spac,url_sponsor,details\n" +
        "10,Known,,https://a.example.com,\n" +
        "11,Unknown,,https://b.example.com,\n"
    ).spacRows;

    const res = await importSpacEditorial(rows, { createMissing: false, dryRun: false });
    expect(res.written).toBe(1);
    expect(res.skippedMissing).toEqual([11]);
    expect((await new SpacRepo().getSpac(10))?.url_sponsor).toBe("https://a.example.com");
    expect(await new SpacRepo().getSpac(11)).toBeUndefined();

    const res2 = await importSpacEditorial(rows, { createMissing: true, dryRun: false });
    expect(res2.written).toBe(2);
    expect(res2.created).toBe(1);
    const created = await new SpacRepo().getSpac(11);
    expect(created?.url_sponsor).toBe("https://b.example.com");
    expect(created?.status).toBe("registered");
  });

  it("dry-run writes nothing", async () => {
    await seedSpac(12);
    const rows = parseEditorialCsv(
      "cik,name,url_spac,url_sponsor,details\n12,Known,,https://c.example.com,\n"
    ).spacRows;
    const res = await importSpacEditorial(rows, { createMissing: false, dryRun: true });
    expect(res.written).toBe(1);
    expect((await new SpacRepo().getSpac(12))?.url_sponsor).toBeNull();
  });
});

describe("SpacReportWriter.recordEditorial", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("does not advance as_of, survives later filing replays, and is re-editable", async () => {
    const writer = new SpacReportWriter();
    await writer.recordRegistration({
      cik: 20,
      accession_number: "20-reg",
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Guarded SPAC Inc.",
      spac_sic: 6770,
    });

    await writer.recordEditorial({
      cik: 20,
      url_sponsor: "https://sponsor.example.com",
      details: '{"unit_price":10}',
    });
    const repo = new SpacRepo();
    let row = await repo.getSpac(20);
    expect(row?.url_sponsor).toBe("https://sponsor.example.com");
    expect(row?.details).toBe('{"unit_price":10}');
    // The editorial write must not advance the filing-date anchor.
    expect(row?.as_of).toBe("2025-12-01");

    // A later automated filing-driven write must not null the editorial fields.
    await writer.recordIpo({
      cik: 20,
      accession_number: "20-ipo",
      filing_date: "2026-01-15",
      form: "424B4",
      primary_document: "424b4.htm",
      ipo_proceeds: 100_000_000,
      trust_amount: 101_000_000,
      spac_tickers: ["GRD.U"],
    });
    row = await repo.getSpac(20);
    expect(row?.url_sponsor).toBe("https://sponsor.example.com");
    expect(row?.details).toBe('{"unit_price":10}');
    expect(row?.as_of).toBe("2026-01-15");

    // Re-editing overwrites the previous editorial value even though the row
    // now carries a newer as_of anchor.
    await writer.recordEditorial({ cik: 20, url_sponsor: "https://corrected.example.com" });
    row = await repo.getSpac(20);
    expect(row?.url_sponsor).toBe("https://corrected.example.com");
    expect(row?.details).toBe('{"unit_price":10}');
    expect(row?.as_of).toBe("2026-01-15");

    // An out-of-order (stale) replay of an older filing still cannot clobber.
    await writer.recordRegistration({
      cik: 20,
      accession_number: "20-reg",
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Guarded SPAC Inc.",
      spac_sic: 6770,
    });
    row = await repo.getSpac(20);
    expect(row?.url_sponsor).toBe("https://corrected.example.com");
    expect(row?.details).toBe('{"unit_price":10}');
  });

  it("versions editorial changes into history with change_source 'editorial'", async () => {
    const writer = new SpacReportWriter();
    await writer.recordRegistration({
      cik: 21,
      accession_number: "21-reg",
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "History SPAC Inc.",
      spac_sic: 6770,
    });
    await writer.recordEditorial({ cik: 21, url_spac: "https://spac.example.com" });

    const history = await new SpacRepo().getHistory(21);
    const open = history.find((h) => h.valid_to == null);
    expect(open?.change_source).toBe("editorial");
    expect(open?.url_spac).toBe("https://spac.example.com");
  });

  it("no-ops when no editorial field is present", async () => {
    const writer = new SpacReportWriter();
    await writer.recordEditorial({ cik: 22 });
    expect(await new SpacRepo().getSpac(22)).toBeUndefined();
  });
});

describe("importFamilyDescriptions", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("writes descriptions under the resolver's normalized name", async () => {
    const rows = parseEditorialCsv(FAMILY_CSV).familyRows;
    const res = await importFamilyDescriptions(rows, { dryRun: false });
    expect(res.written).toBe(2);

    const repo = new FamilyDescriptionRepo();
    const desc = await repo.getDescription(
      "underwriter-family",
      normalizeUnderwriterFamilyName("chardan")
    );
    expect(desc).toBe("Chardan is a SPAC-focused investment bank.");
  });
});
