/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { parseInlineXbrl } from "./parseInlineXbrl";
import { applyIxtTransform } from "./ixtTransforms";

const WRAP_OPEN =
  `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"` +
  ` xmlns:xbrli="http://www.xbrl.org/2003/instance"` +
  ` xmlns:dei="http://xbrl.sec.gov/dei/2025"` +
  ` xmlns:us-gaap="http://fasb.org/us-gaap/2025"` +
  ` xmlns:xbrldi="http://xbrl.org/2006/xbrldi"><body>`;
const WRAP_CLOSE = `</body></html>`;

const HEADER =
  `<div style="display:none"><ix:header><ix:resources>` +
  `<xbrli:context id="c1">` +
  `<xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0002114227</xbrli:identifier>` +
  `<xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">us-gaap:CommonClassAMember</xbrldi:explicitMember></xbrli:segment>` +
  `</xbrli:entity>` +
  `<xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period>` +
  `</xbrli:context>` +
  `<xbrli:context id="c2">` +
  `<xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0002114227</xbrli:identifier></xbrli:entity>` +
  `<xbrli:period><xbrli:instant>2026-03-31</xbrli:instant></xbrli:period>` +
  `</xbrli:context>` +
  `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>` +
  `<xbrli:unit id="usdPershares"><xbrli:divide>` +
  `<xbrli:unitNumerator><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unitNumerator>` +
  `<xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator>` +
  `</xbrli:divide></xbrli:unit>` +
  `</ix:resources></ix:header></div>`;

function doc(body: string): string {
  return WRAP_OPEN + HEADER + body + WRAP_CLOSE;
}

describe("parseInlineXbrl", () => {
  it("returns hasXbrl=false for plain HTML", () => {
    const result = parseInlineXbrl("<html><body><p>No tagging here.</p></body></html>");
    expect(result.hasXbrl).toBe(false);
    expect(result.facts).toHaveLength(0);
  });

  it("parses contexts with periods, entity, and dimensions", () => {
    const result = parseInlineXbrl(doc(""));
    expect(result.hasXbrl).toBe(true);
    const c1 = result.contexts.get("c1")!;
    expect(c1.entityIdentifier).toBe("0002114227");
    expect(c1.entityScheme).toBe("http://www.sec.gov/CIK");
    expect(c1.periodStart).toBe("2026-01-01");
    expect(c1.periodEnd).toBe("2026-03-31");
    expect(c1.periodInstant).toBeNull();
    expect(c1.dimensions).toEqual([
      {
        dimension: "us-gaap:StatementClassOfStockAxis",
        member: "us-gaap:CommonClassAMember",
        isTyped: false,
      },
    ]);
    const c2 = result.contexts.get("c2")!;
    expect(c2.periodInstant).toBe("2026-03-31");
    expect(c2.dimensions).toHaveLength(0);
  });

  it("normalizes simple and divide units", () => {
    const result = parseInlineXbrl(doc(""));
    expect(result.units.get("usd")?.measure).toBe("USD");
    expect(result.units.get("usdPershares")?.measure).toBe("USD/shares");
  });

  it("parses nonFraction with format, scale, and sign", () => {
    const result = parseInlineXbrl(
      doc(
        `<p>Deficit of $(<ix:nonFraction contextRef="c2" unitRef="usd" name="us-gaap:RetainedEarningsAccumulatedDeficit"` +
          ` decimals="-3" format="ixt:num-dot-decimal" scale="3" sign="-">1,234</ix:nonFraction>)</p>`
      )
    );
    expect(result.facts).toHaveLength(1);
    const fact = result.facts[0];
    expect(fact.concept).toBe("us-gaap:RetainedEarningsAccumulatedDeficit");
    expect(fact.namespace).toBe("http://fasb.org/us-gaap/2025");
    expect(fact.contextRef).toBe("c2");
    expect(fact.unitRef).toBe("usd");
    expect(fact.value).toBe("1234");
    expect(fact.numericValue).toBe(-1234000);
    expect(fact.decimals).toBe("-3");
    expect(fact.scale).toBe(3);
    expect(fact.sign).toBe("-");
    expect(fact.isNumeric).toBe(true);
    expect(fact.isHidden).toBe(false);
    expect(fact.source).toBe("inline");
  });

  it("keeps raw text and null numericValue for unknown transforms", () => {
    const result = parseInlineXbrl(
      doc(
        `<ix:nonFraction contextRef="c2" unitRef="usd" name="us-gaap:Cash"` +
          ` format="ixt:mystery-transform">1,000</ix:nonFraction>`
      )
    );
    expect(result.facts[0].value).toBe("1,000");
    expect(result.facts[0].numericValue).toBeNull();
    expect(result.facts[0].format).toBe("ixt:mystery-transform");
  });

  it("treats zero-dash as 0 and honors xsi:nil", () => {
    const result = parseInlineXbrl(
      doc(
        `<ix:nonFraction contextRef="c2" unitRef="usd" name="us-gaap:Cash" format="ixt:zero-dash">—</ix:nonFraction>` +
          `<ix:nonNumeric contextRef="c1" name="dei:AmendmentDescription" xsi:nil="true"></ix:nonNumeric>`
      )
    );
    expect(result.facts[0].numericValue).toBe(0);
    expect(result.facts[1].isNil).toBe(true);
    expect(result.facts[1].numericValue).toBeNull();
  });

  it("marks facts inside ix:hidden and follows continuation chains", () => {
    const result = parseInlineXbrl(
      doc(
        `<div style="display:none"><ix:hidden>` +
          `<ix:nonNumeric contextRef="c1" name="dei:EntityCentralIndexKey">0002114227</ix:nonNumeric>` +
          `</ix:hidden></div>` +
          `<ix:nonNumeric contextRef="c1" name="us-gaap:NatureOfOperations" continuedAt="cont1">Part one. </ix:nonNumeric>` +
          `<ix:continuation id="cont1" continuedAt="cont2">Part two. </ix:continuation>` +
          `<ix:continuation id="cont2">Part three.</ix:continuation>`
      )
    );
    const hidden = result.facts.find((f) => f.concept === "dei:EntityCentralIndexKey")!;
    expect(hidden.isHidden).toBe(true);
    const continued = result.facts.find((f) => f.concept === "us-gaap:NatureOfOperations")!;
    expect(continued.isHidden).toBe(false);
    expect(continued.value).toBe("Part one. Part two. Part three.");
  });

  it("drops ix:exclude content from fact values", () => {
    const result = parseInlineXbrl(
      doc(
        `<ix:nonNumeric contextRef="c1" name="dei:DocumentType">S-1<ix:exclude><span> (excluded)</span></ix:exclude></ix:nonNumeric>`
      )
    );
    expect(result.facts[0].value).toBe("S-1");
  });

  it("transforms ballot-box booleans", () => {
    const result = parseInlineXbrl(
      doc(
        `<ix:nonNumeric contextRef="c1" name="dei:EntityEmergingGrowthCompany" format="ixt-sec:boolballotbox">☒</ix:nonNumeric>` +
          `<ix:nonNumeric contextRef="c1" name="dei:EntitySmallBusiness" format="ixt-sec:boolballotbox">☐</ix:nonNumeric>`
      )
    );
    expect(result.facts[0].value).toBe("true");
    expect(result.facts[1].value).toBe("false");
  });

  it("normalizes a dei date fact to ISO-8601", () => {
    const result = parseInlineXbrl(
      doc(
        `<ix:nonNumeric contextRef="c1" name="dei:DocumentPeriodEndDate" format="ixt:date-monthname-day-year-en">March 31, 2026</ix:nonNumeric>`
      )
    );
    expect(result.facts[0].value).toBe("2026-03-31");
    expect(result.facts[0].isNumeric).toBe(false);
    // Date facts are non-numeric — the ISO string is the value, numericValue stays null.
    expect(result.facts[0].numericValue).toBeNull();
  });
});

describe("applyIxtTransform", () => {
  it("handles comma-decimal style", () => {
    expect(applyIxtTransform("ixt:num-comma-decimal", "1.234.567,89")).toBe("1234567.89");
  });
  it("returns null for unregistered transforms", () => {
    expect(applyIxtTransform("ixt-sec:durwordsen", "five years")).toBeNull();
  });
  it("passes text through when no format is given", () => {
    expect(applyIxtTransform(null, "  plain  ")).toBe("plain");
  });

  describe("date transforms -> ISO-8601", () => {
    it("monthname-day-year (TR3/TR4 hyphenated + TR1 concatenated)", () => {
      expect(applyIxtTransform("ixt:date-monthname-day-year-en", "September 3, 2024")).toBe(
        "2024-09-03"
      );
      expect(applyIxtTransform("ixt:datemonthdayyearen", "Sept. 3 2024")).toBe("2024-09-03");
      expect(applyIxtTransform("ixt:date-monthname-day-year-en", "December 31, 2023")).toBe(
        "2023-12-31"
      );
    });
    it("day-monthname-year", () => {
      expect(applyIxtTransform("ixt:date-day-monthname-year-en", "3 September 2024")).toBe(
        "2024-09-03"
      );
      expect(applyIxtTransform("ixt:datedaymonthyearen", "31 December 2023")).toBe("2023-12-31");
    });
    it("numeric slash forms (US month/day/year vs EU day/month/year)", () => {
      expect(applyIxtTransform("ixt:date-month-day-year", "9/3/2024")).toBe("2024-09-03");
      expect(applyIxtTransform("ixt:dateslashus", "12-31-2023")).toBe("2023-12-31");
      expect(applyIxtTransform("ixt:date-day-month-year", "3/9/2024")).toBe("2024-09-03");
      expect(applyIxtTransform("ixt:dateslasheu", "31.12.2023")).toBe("2023-12-31");
      expect(applyIxtTransform("ixt:date-year-month-day", "2024-09-03")).toBe("2024-09-03");
    });
    it("falls back to trimmed raw text when a date is unparseable (never blanks it)", () => {
      expect(applyIxtTransform("ixt:date-monthname-day-year-en", "  Marchtember 3, 2024 ")).toBe(
        "Marchtember 3, 2024"
      );
      // Out-of-range month/day is rejected and the raw text is kept.
      expect(applyIxtTransform("ixt:date-month-day-year", "13/45/2024")).toBe("13/45/2024");
    });

    it("rejects impossible calendar dates rather than emitting an invalid ISO string", () => {
      // Feb 30 and Apr 31 don't exist — keep the raw text instead of "2024-02-30".
      expect(applyIxtTransform("ixt:date-month-day-year", "2/30/2024")).toBe("2/30/2024");
      expect(applyIxtTransform("ixt:date-monthname-day-year-en", "April 31, 2024")).toBe(
        "April 31, 2024"
      );
      // Feb 29 is valid on a leap year, invalid otherwise.
      expect(applyIxtTransform("ixt:date-month-day-year", "2/29/2024")).toBe("2024-02-29");
      expect(applyIxtTransform("ixt:date-month-day-year", "2/29/2023")).toBe("2/29/2023");
    });
  });
});
