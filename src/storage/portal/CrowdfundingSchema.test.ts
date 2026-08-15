/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { CrowdfundingReportsSchema } from "./CrowdfundingSchema";

/**
 * `crowdfunding_reports.disclosure_value` must carry no lower bound.
 *
 * A `minimum: 0` here emits a `CHECK (disclosure_value >= 0)` constraint, and
 * four of the eighteen Reg CF disclosures are routinely negative:
 * netIncome/taxPaid for both the most recent and prior fiscal year. A Reg CF
 * issuer is an early-stage company, so a loss is the common case.
 *
 * This is asserted on the SCHEMA rather than by round-tripping a row, because a
 * round-trip cannot fail: every storage test runs on InMemoryTabularStorage,
 * which enforces no CHECK constraint. That is exactly how the bound survived —
 * see the fixture census below, which shows the committed corpus was never the
 * gap. The failure only ever appeared against a real database, and there it was
 * a PARTIAL write: the parent `crowdfunding` row committed while the disclosure
 * insert aborted at the first negative value, silently dropping that field and
 * every one after it.
 */
describe("CrowdfundingReportsSchema.disclosure_value", () => {
  const disclosureValue = CrowdfundingReportsSchema.properties.disclosure_value;

  it("permits negative values", () => {
    // TypeNullable wraps the number in a union, so check every branch rather
    // than assuming which position the numeric one occupies.
    const branches = "anyOf" in disclosureValue ? disclosureValue.anyOf : [disclosureValue];
    for (const branch of branches as Array<Record<string, unknown>>) {
      expect(branch.minimum, `disclosure_value branch declares minimum: ${branch.minimum}`).toBe(
        undefined
      );
      expect(
        branch.exclusiveMinimum,
        `disclosure_value branch declares exclusiveMinimum: ${branch.exclusiveMinimum}`
      ).toBe(undefined);
    }
  });
});

/**
 * Census of the committed Form C fixtures, asserting that the corpus really
 * does exercise the negative case.
 *
 * This is the guard that says WHY the schema test above matters. If a future
 * change swaps the fixtures for a sanitized set with no losses in it, the
 * schema assertion still passes but the pipeline tests stop covering the shape
 * that broke production — and this fails instead of going quiet.
 */
describe("Form C fixtures cover negative financial disclosures", () => {
  const readFixtureValues = (slug: string, tag: string): number[] => {
    const dir = join(__dirname, "..", "..", "sec", "forms", "exempt-offerings", "mock_data", slug);
    const pattern = new RegExp(`<${tag}>([^<]*)</${tag}>`);
    return readdirSync(dir)
      .filter((f) => f.endsWith(".xml"))
      .map((f) => pattern.exec(readFileSync(join(dir, f), "utf-8"))?.[1])
      .filter((v): v is string => v !== undefined)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
  };

  it("has Form C filings reporting a net loss", () => {
    const values = readFixtureValues("form-c", "netIncomeMostRecentFiscalYear");
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((v) => v < 0).length).toBeGreaterThan(0);
  });

  it("has a Form C-AR filing reporting a negative tax figure", () => {
    // Less intuitive than a net loss and just as real: a refund or adjustment
    // shows as negative tax paid. form-c-ar/000166516025000653 is the committed
    // example (-8727.00).
    const values = readFixtureValues("form-c-ar", "taxPaidMostRecentFiscalYear");
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((v) => v < 0).length).toBeGreaterThan(0);
  });
});
