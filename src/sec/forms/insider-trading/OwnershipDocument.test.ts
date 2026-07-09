/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { Form_3 } from "./Form_3";
import { Form_4 } from "./Form_4";
import { Form_5 } from "./Form_5";

const CASES = [
  { dir: "form-3", form: "3" as const, parser: Form_3, expectType: "3" },
  { dir: "form-3-a", form: "3/A" as const, parser: Form_3, expectType: "3/A" },
  { dir: "form-4", form: "4" as const, parser: Form_4, expectType: "4" },
  { dir: "form-4-a", form: "4/A" as const, parser: Form_4, expectType: "4/A" },
  { dir: "form-5", form: "5" as const, parser: Form_5, expectType: "5" },
];

function listFixtures(dir: string): string[] {
  return readdirSync(join(__dirname, "mock_data", dir)).filter((f) =>
    f.endsWith("-primary_doc.xml")
  );
}

describe("OwnershipDocument parsing (Forms 3/4/5)", () => {
  for (const { dir, form, parser, expectType } of CASES) {
    it(`parses every ${form} fixture in mock_data/${dir}`, async () => {
      const files = listFixtures(dir);
      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        const xml = readFileSync(join(__dirname, "mock_data", dir, file), "utf-8");
        const doc = await (parser as typeof Form_4).parse(form as "4", xml);

        expect(doc).toBeDefined();
        expect(doc.documentType).toBe(expectType);
        expect(doc.issuer?.issuerCik).toMatch(/^\d+$/);
        expect(doc.issuer?.issuerName).toBeTruthy();
        // reportingOwner is always forced to an array by the parser.
        expect(Array.isArray(doc.reportingOwner)).toBe(true);
        expect(doc.reportingOwner!.length).toBeGreaterThan(0);
      }
    });
  }

  it("forces single-element tables into arrays", async () => {
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000149315226025476-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_4.parse("4", xml);
    expect(Array.isArray(doc.nonDerivativeTable?.nonDerivativeTransaction)).toBe(true);
    expect(doc.nonDerivativeTable?.nonDerivativeTransaction?.length).toBe(1);
    expect(Array.isArray(doc.derivativeTable?.derivativeTransaction)).toBe(true);
    expect(doc.derivativeTable?.derivativeTransaction?.length).toBe(1);
  });

  it("unwraps value-wrapped leaves (numerics kept as raw strings; storage coerces)", async () => {
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000149315226025476-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_4.parse("4", xml);
    const txn = doc.nonDerivativeTable!.nonDerivativeTransaction![0];
    // VALUE_NUMBER's inner value is typed as a string so an empty <transactionShares><value/></transactionShares>
    // survives Value.Convert intact (as "") instead of becoming a fabricated 0. Storage's num() helper
    // is the single place that coerces populated strings to numbers and "" to null.
    expect(txn.transactionAmounts?.transactionShares?.value).toBe("177936");
    expect(txn.transactionAmounts?.transactionPricePerShare?.value).toBe("1.405");
    expect(txn.securityTitle?.value).toBe("Common Stock");
  });

  it("parses derivative and non-derivative holdings on a Form 3/A", async () => {
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-3-a", "000095010326007758-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_3.parse("3/A", xml);
    expect(doc.nonDerivativeTable?.nonDerivativeHolding?.length).toBe(1);
    expect(doc.derivativeTable?.derivativeHolding?.length).toBe(2);
    // exerciseDate carries only a footnoteId (no value) — must not crash.
    expect(doc.derivativeTable?.derivativeHolding?.[0]?.exerciseDate?.value).toBeUndefined();
  });

  it("rejects a mismatched form symbol", async () => {
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000090266426002604-primary_doc.xml"),
      "utf-8"
    );
    // @ts-expect-error intentionally passing a symbol Form_4 does not handle
    await expect(Form_4.parse("3", xml)).rejects.toThrow();
  });
});
