/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { normalizeCompanyName } from "./CompanyNormalization";
import { parentClauseSourceContext, splitParentClause } from "./splitParentClause";

function splitOf(
  asFiled: string,
  observationName: string,
  familyName: string
): ReturnType<typeof splitParentClause> {
  return { observationName, familyName, asFiled, split: true };
}

function intact(asFiled: string): ReturnType<typeof splitParentClause> {
  return { observationName: asFiled, familyName: asFiled, asFiled, split: false };
}

describe("splitParentClause", () => {
  it("splits comma division-of and does not copy Y's legal form onto X", () => {
    // X is whatever the filer wrote before the clause — no form is grafted on.
    expect(
      splitParentClause("Kingswood Capital Markets, division of Benchmark Investments, Inc.")
    ).toEqual(
      splitOf(
        "Kingswood Capital Markets, division of Benchmark Investments, Inc.",
        "Kingswood Capital Markets",
        "Benchmark Investments, Inc."
      )
    );
    expect(
      splitParentClause("Polaris Advisory Partners, a division of Kingswood Capital LLC")
    ).toEqual(
      splitOf(
        "Polaris Advisory Partners, a division of Kingswood Capital LLC",
        "Polaris Advisory Partners",
        "Kingswood Capital LLC"
      )
    );
  });

  it("splits a trailing parenthetical clause", () => {
    expect(
      splitParentClause(
        "Kingswood Capital Markets (a division of Benchmark Investments, Inc.)"
      )
    ).toEqual(
      splitOf(
        "Kingswood Capital Markets (a division of Benchmark Investments, Inc.)",
        "Kingswood Capital Markets",
        "Benchmark Investments, Inc."
      )
    );
    expect(
      splitParentClause(
        "Kingswood Capital Markets, (a division of Benchmark Investments, Inc.)"
      )
    ).toEqual(
      splitOf(
        "Kingswood Capital Markets, (a division of Benchmark Investments, Inc.)",
        "Kingswood Capital Markets",
        "Benchmark Investments, Inc."
      )
    );
  });

  it("splits wholly-owned / wholly owned × division / subsidiary", () => {
    expect(
      splitParentClause("Acme Sponsor LLC, a wholly-owned subsidiary of Big Bank Inc.")
    ).toEqual(
      splitOf(
        "Acme Sponsor LLC, a wholly-owned subsidiary of Big Bank Inc.",
        "Acme Sponsor LLC",
        "Big Bank Inc."
      )
    );
    expect(splitParentClause("Foo, a wholly owned division of Bar LLC")).toEqual(
      splitOf("Foo, a wholly owned division of Bar LLC", "Foo", "Bar LLC")
    );
  });

  // Now trivially true — nothing is ever copied — but kept as a regression pin:
  // an X that carries its OWN legal form must still come through untouched.
  it("does not copy a form when X already has one", () => {
    expect(
      splitParentClause("Acme Sponsor LLC, a wholly-owned subsidiary of Big Bank Inc.")
        .observationName
    ).toBe("Acme Sponsor LLC");
  });

  it("leaves a Partners/Holdings X exactly as filed", () => {
    expect(
      splitParentClause("Polaris Advisory Partners, a division of Kingswood Capital LLC")
        .observationName
    ).toBe("Polaris Advisory Partners");
  });

  it("does not split when there is no clause, X/Y is empty, or the wording is DBA / majority / indirect", () => {
    expect(splitParentClause("Goldman Sachs & Co. LLC")).toEqual(intact("Goldman Sachs & Co. LLC"));
    expect(splitParentClause("Foo d/b/a Bar Inc.")).toEqual(intact("Foo d/b/a Bar Inc."));
    expect(splitParentClause("Foo, a majority-owned subsidiary of Bar Inc.")).toEqual(
      intact("Foo, a majority-owned subsidiary of Bar Inc.")
    );
    expect(splitParentClause("Foo, an indirect wholly-owned subsidiary of Bar Inc.")).toEqual(
      intact("Foo, an indirect wholly-owned subsidiary of Bar Inc.")
    );
    expect(splitParentClause(", a division of Bar Inc.")).toEqual(intact(", a division of Bar Inc."));
    expect(splitParentClause("")).toEqual(intact(""));
  });

  it("does not under-merge a real underwriter filed both ways (Cantor Fitzgerald)", () => {
    // The observed regression. Copying the parent's `L.P.` produced the
    // observation name "Cantor Fitzgerald Securities LP", and LP is a
    // CANONICALIZE form — normalizeCompanyName keeps it — so the fabricated
    // name did not converge with the same underwriter named plainly on the
    // next filing. Two canonical companies, two identity links, one firm.
    const split = splitParentClause(
      "Cantor Fitzgerald Securities, a division of Cantor Fitzgerald, L.P."
    );
    expect(split.observationName).toBe("Cantor Fitzgerald Securities");
    expect(normalizeCompanyName(split.observationName)).toBe(
      normalizeCompanyName("Cantor Fitzgerald Securities")
    );
    // The parent house is not lost by declining to copy its form: it is still
    // carried on the split, and from there into source_context.family_name.
    expect(split.familyName).toBe("Cantor Fitzgerald, L.P.");
  });

  it("does not under-merge on the other canonicalize/keep forms (LLC, Trust)", () => {
    // LP is not special. Any form normalizeCompanyName does NOT strip survives
    // onto the identity key, so copying it splits the tier the same way. (Corp
    // and Inc converged only by accident — those two are stripped.)
    for (const [filed, parent] of [
      ["Foo Advisors, a division of Bar Capital LLC", "Bar Capital LLC"],
      ["Foo Advisors, a division of Bar Family Trust", "Bar Family Trust"],
    ] as const) {
      const split = splitParentClause(filed);
      expect(split.observationName, filed).toBe("Foo Advisors");
      expect(normalizeCompanyName(split.observationName), filed).toBe(
        normalizeCompanyName("Foo Advisors")
      );
      expect(split.familyName, filed).toBe(parent);
    }
  });

  it("builds source_context with as_filed and family_name only on a split", () => {
    const split = splitParentClause(
      "Kingswood Capital Markets, division of Benchmark Investments, Inc."
    );
    expect(JSON.parse(parentClauseSourceContext("s1:underwriter", split))).toEqual({
      relation: "s1:underwriter",
      as_filed: "Kingswood Capital Markets, division of Benchmark Investments, Inc.",
      family_name: "Benchmark Investments, Inc.",
    });
    expect(
      JSON.parse(
        parentClauseSourceContext("s1:spac-sponsor", splitParentClause("Goldman Sachs & Co. LLC"))
      )
    ).toEqual({ relation: "s1:spac-sponsor" });
  });
});
