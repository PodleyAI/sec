/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Form_144 } from "./Form_144";

const CASES = [
  { dir: "form-144", form: "144" as const, expectType: "144" },
  { dir: "form-144-a", form: "144/A" as const, expectType: "144/A" },
];

function listFixtures(dir: string): string[] {
  return readdirSync(join(__dirname, "mock_data", dir)).filter((f) =>
    f.endsWith("-primary_doc.xml")
  );
}

describe("Form 144 parsing", () => {
  for (const { dir, form, expectType } of CASES) {
    it(`parses every ${form} fixture in mock_data/${dir}`, async () => {
      const files = listFixtures(dir);
      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        const xml = readFileSync(join(__dirname, "mock_data", dir, file), "utf-8");
        const doc = await Form_144.parse(form, xml);

        expect(doc.headerData?.submissionType).toBe(expectType);
        expect(doc.formData?.issuerInfo?.issuerCik).toMatch(/^\d+$/);
        expect(doc.formData?.issuerInfo?.issuerName).toBeTruthy();
      }
    });
  }

  it("forces repeating tables into arrays and coerces numbers / strips com: prefix", async () => {
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-144", "000166326626000003-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_144.parse("144", xml);
    const fd = doc.formData!;

    expect(Array.isArray(fd.securitiesToBeSold)).toBe(true);
    expect(fd.securitiesToBeSold!.length).toBe(2);
    expect(Array.isArray(fd.securitiesSoldInPast3Months)).toBe(true);
    expect(fd.securitiesSoldInPast3Months!.length).toBe(2);
    expect(Array.isArray(fd.issuerInfo?.relationshipsToIssuer?.relationshipToIssuer)).toBe(true);

    // Numeric leaves are kept as raw strings; storage coerces them.
    expect(fd.securitiesInformation?.noOfUnitsSold).toBe("129915");
    expect(fd.securitiesInformation?.aggregateMarketValue).toBe("9019409.69");
    // com:street1 -> street1 after removeNSPrefix
    expect(fd.issuerInfo?.issuerAddress?.street1).toBe("2323 Victory Avenue Suite 1400");
    expect(fd.securitiesSoldInPast3Months?.[0]?.sellerDetails?.address?.city).toBe("Dallas");
  });

  it("parses an amendment with nothing-to-report and no recent sales", async () => {
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-144-a", "000166326626000004-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_144.parse("144/A", xml);
    expect(doc.formData?.nothingToReportFlagOnSecuritiesSoldInPast3Months).toBe("Y");
    expect(doc.formData?.securitiesSoldInPast3Months).toBeUndefined();
  });

  it("rejects a mismatched form symbol", async () => {
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-144", "000166326626000003-primary_doc.xml"),
      "utf-8"
    );
    // @ts-expect-error intentionally passing a symbol Form_144 does not handle
    await expect(Form_144.parse("4", xml)).rejects.toThrow();
  });
});
