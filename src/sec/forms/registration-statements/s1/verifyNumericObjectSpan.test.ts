/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { verifyNumericObjectSpan } from "./verifyNumericObjectSpan";

const OFFERING_FIELDS = [
  { key: "units_offered", label: "units" },
  { key: "price_per_unit", label: "per unit" },
  { key: "trust_per_unit", label: "trust" },
  { key: "gross_proceeds", label: "proceeds" },
] as const;

const SECTION = "We are offering 20,000,000 units at $10.00 per unit. $10.00 per unit is deposited in trust.";

describe("verifyNumericObjectSpan", () => {
  it("keeps a verbatim source_span", () => {
    expect(
      verifyNumericObjectSpan(
        SECTION,
        { source_span: "20,000,000 units at $10.00 per unit", units_offered: 99 },
        OFFERING_FIELDS
      )
    ).toBe("ok");
  });

  it("accepts a paraphrased span when two numeric fields locate in the section", () => {
    expect(
      verifyNumericObjectSpan(
        SECTION,
        {
          source_span: "a paraphrase the section does not contain",
          units_offered: 20_000_000,
          price_per_unit: 10,
        },
        OFFERING_FIELDS
      )
    ).toBe("ok");
  });

  it("does not persist on a single coincidental number", () => {
    expect(
      verifyNumericObjectSpan(
        SECTION,
        {
          source_span: "a paraphrase the section does not contain",
          units_offered: 20_000_000,
          price_per_unit: 47,
        },
        OFFERING_FIELDS
      )
    ).toBe("not-found");
  });

  it("keeps not-found when the figures are absent from the section", () => {
    expect(
      verifyNumericObjectSpan(
        SECTION,
        {
          source_span: "a paraphrase the section does not contain",
          units_offered: 99_999_999,
          price_per_unit: 47,
        },
        OFFERING_FIELDS
      )
    ).toBe("not-found");
  });
});
