/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
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
  it("splits comma division-of and copies Y's legal form onto X", () => {
    expect(
      splitParentClause("Kingswood Capital Markets, division of Benchmark Investments, Inc.")
    ).toEqual(
      splitOf(
        "Kingswood Capital Markets, division of Benchmark Investments, Inc.",
        "Kingswood Capital Markets Inc",
        "Benchmark Investments, Inc."
      )
    );
    expect(
      splitParentClause("Polaris Advisory Partners, a division of Kingswood Capital LLC")
    ).toEqual(
      splitOf(
        "Polaris Advisory Partners, a division of Kingswood Capital LLC",
        "Polaris Advisory Partners LLC",
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
        "Kingswood Capital Markets Inc",
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
        "Kingswood Capital Markets Inc",
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
      splitOf("Foo, a wholly owned division of Bar LLC", "Foo LLC", "Bar LLC")
    );
  });

  it("does not copy a form when X already has one", () => {
    expect(
      splitParentClause("Acme Sponsor LLC, a wholly-owned subsidiary of Big Bank Inc.")
        .observationName
    ).toBe("Acme Sponsor LLC");
  });

  it("copies GP the same way it copies LLC", () => {
    expect(splitParentClause("Foo, a division of Bar G.P.")).toEqual(
      splitOf("Foo, a division of Bar G.P.", "Foo GP", "Bar G.P.")
    );
  });

  it("does not treat Partners/Holdings as a legal form (not hasCompanyEnding)", () => {
    expect(
      splitParentClause("Polaris Advisory Partners, a division of Kingswood Capital LLC")
        .observationName
    ).toBe("Polaris Advisory Partners LLC");
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
