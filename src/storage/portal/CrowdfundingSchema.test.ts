/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { determineStatus } from "../../sec/forms/exempt-offerings/Form_C.storage";
import { EXEMPT_OFFERING_FORM_CODES } from "../../sec/forms/exempt-offerings/form-slugs";
import { CrowdfundingReportsSchema, CrowdfundingSchema } from "./CrowdfundingSchema";

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
 * The narrative fields must match EDGAR's declared width, read from the XSD
 * rather than pinned to a literal — so if EDGAR restates the type, this fails
 * instead of silently disagreeing with the source of truth.
 *
 * `progress_update` and `nature_of_amendment` were 255 against EDGAR's
 * STRING_256_TYPE. That one character cost the WHOLE filing: a filer using the
 * last character EDGAR allows hit a STORE_ERROR and the parent `crowdfunding`
 * row never landed. It was found only by a live sweep, because in-memory test
 * storage enforces no varchar width — the same blind spot that hid the
 * disclosure_value bound above.
 */
describe("Form C narrative widths match the EDGAR XSD", () => {
  const xsd = readFileSync(
    join(__dirname, "..", "..", "sec", "forms", "exempt-offerings", "Form_C.definition.filer.xsd"),
    "utf-8"
  );

  const declaredWidth = (element: string): number => {
    const m = new RegExp(
      `<xs:element\\s+name="${element}"\\s+type="(?:ns1:)?STRING_(\\d+)_TYPE`
    ).exec(xsd);
    if (!m) throw new Error(`XSD declares no STRING_n_TYPE for <${element}>`);
    return Number(m[1]);
  };

  const schemaWidth = (field: "progress_update" | "nature_of_amendment"): number => {
    const prop = CrowdfundingSchema.properties[field];
    const branches = ("anyOf" in prop ? prop.anyOf : [prop]) as Array<Record<string, unknown>>;
    const widths = branches
      .map((b) => b.maxLength)
      .filter((n): n is number => typeof n === "number");
    if (widths.length === 0) throw new Error(`${field} declares no maxLength`);
    return Math.min(...widths);
  };

  it.each([
    ["progress_update", "progressUpdate"],
    ["nature_of_amendment", "natureOfAmendment"],
  ] as const)("%s matches <%s>", (field, element) => {
    expect(schemaWidth(field)).toBe(declaredWidth(element));
  });
});

/**
 * Every status `determineStatus` can return must fit the column that stores it.
 *
 * This is the one bound that had nothing to do with EDGAR: the overflowing
 * value is a constant this repo generates, so the failure was total rather than
 * long-tail — `C-U-W`, `C-AR-W`, `C-AR/A-W` and `C-TR-W` could never store a
 * single filing between them, because their status is always 21-25 characters
 * against a `varchar(20)`.
 *
 * Driven off `EXEMPT_OFFERING_FORM_CODES` rather than a hand-written list, so a
 * new Form C variant is covered the moment it is registered, and asserted
 * against the schema's own `maxLength` rather than a literal, so widening the
 * column cannot leave this test pinned to the old width.
 */
describe("determineStatus output fits crowdfunding.status", () => {
  const maxLength = (CrowdfundingSchema.properties.status as { maxLength?: number })
    .maxLength as number;
  const formCodes = EXEMPT_OFFERING_FORM_CODES.filter((f) => f.startsWith("C"));

  it("declares a maxLength", () => {
    expect(typeof maxLength).toBe("number");
  });

  it("covers the whole Form C family", () => {
    // Guards the guard: if the filter above ever selects nothing, every
    // assertion below passes vacuously.
    expect(formCodes.length).toBeGreaterThanOrEqual(12);
  });

  it.each(formCodes)("%s", (form) => {
    const status = determineStatus(form);
    expect(
      status.length,
      `determineStatus(${JSON.stringify(form)}) = ${JSON.stringify(status)} is ` +
        `${status.length} chars, over the ${maxLength}-char column`
    ).toBeLessThanOrEqual(maxLength);
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
