/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from "vitest";
import { setupAllDatabases } from "../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { parseEditorialCsv } from "./editorialImport";

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
    const parsed = parseEditorialCsv("family_kind,name,description\nleadership,Someone,text\n");
    expect(parsed.familyRows).toHaveLength(0);
    expect(parsed.errors[0]).toContain("unknown family_kind");
  });

  it("errors on an unrecognized header", () => {
    const parsed = parseEditorialCsv("foo,bar\n1,2\n");
    expect(parsed.errors[0]).toContain("unrecognized header");
  });
});
