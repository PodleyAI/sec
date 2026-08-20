/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { DeterministicPass } from "./deterministicPass";
import { preempts } from "./deterministicPass";

interface Row {
  readonly confidence: number;
}

/** A pass whose `extract` is never reached — every case here is about `covers`. */
function pass(covers: DeterministicPass<Row>["covers"]): DeterministicPass<Row> {
  return { extract: () => [], covers };
}

const TEXT = "the section text";

describe("preempts", () => {
  it("declines when clears names a column covers omits", () => {
    // The underwriters shape: the syndicate table states the allocation, the
    // role is prose beside it. Named column by column, the pass cannot claim
    // the column it would otherwise overwrite with null.
    const clears = new Set([
      "underwriter_link.role_detail",
      "underwriter_link.shares_allocated",
      "company_observation",
    ]);
    const covers = new Set(["underwriter_link.shares_allocated", "company_observation"]);

    expect(preempts(pass(covers), clears, TEXT)).toBe(false);
  });

  it("still preempts a table-granularity pair", () => {
    // spac-sponsors: the parse fills every column persist writes, so naming the
    // tables bare on both sides is the honest declaration and keeps working.
    const both = new Set([
      "spac_sponsor_link",
      "sponsor_family_membership",
      "company_observation",
      "observation_provenance",
    ]);

    expect(preempts(pass(new Set(both)), both, TEXT)).toBe(true);
  });

  it("declines when the two sets mix granularity for one table", () => {
    // Names are compared as plain strings and a bare table never expands to its
    // columns, so a half-migrated declaration fails safe in BOTH directions
    // rather than silently claiming (or silently losing) the whole table.
    expect(
      preempts(
        pass(new Set(["beneficial_ownership"])),
        new Set(["beneficial_ownership.shares_owned"]),
        TEXT
      )
    ).toBe(false);
    expect(
      preempts(
        pass(new Set(["beneficial_ownership.shares_owned"])),
        new Set(["beneficial_ownership"]),
        TEXT
      )
    ).toBe(false);
  });

  it("resolves a function-valued covers against the section text", () => {
    // The promote/ownership shape: whether a null column is a loss or the
    // filing's own answer is a property of THIS section's tables.
    const covers = (text: string): ReadonlySet<string> =>
      text.includes("Shares Offered")
        ? new Set(["beneficial_ownership.shares_owned"])
        : new Set(["beneficial_ownership.shares_owned", "beneficial_ownership.shares_offered"]);
    const clears = new Set([
      "beneficial_ownership.shares_owned",
      "beneficial_ownership.shares_offered",
    ]);

    expect(preempts(pass(covers), clears, "a pre-IPO table with no offered column")).toBe(true);
    expect(preempts(pass(covers), clears, "a resale table with a Shares Offered column")).toBe(
      false
    );
  });

  it("declines when the coverage function throws", () => {
    // A coverage function reads the section, so it can fail the way any parse
    // can. Declining costs one model call; propagating would abort a section
    // the model could still have extracted.
    const covers = (): ReadonlySet<string> => {
      throw new Error("unreadable table");
    };

    expect(preempts(pass(covers), new Set(["use_of_proceeds"]), TEXT)).toBe(false);
  });

  it("declines an undefined clears", () => {
    // A caller that never said what the section rewrites has not shown the
    // parse can supply it.
    expect(preempts(pass(new Set(["use_of_proceeds"])), undefined, TEXT)).toBe(false);
  });
});
