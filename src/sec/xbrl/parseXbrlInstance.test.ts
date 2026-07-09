/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { parseXbrlInstance } from "./parseXbrlInstance";

const INSTANCE = `<?xml version="1.0" encoding="utf-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
  xmlns:dei="http://xbrl.sec.gov/dei/2014-01-31"
  xmlns:us-gaap="http://fasb.org/us-gaap/2014-01-31"
  xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <xbrli:context id="D2014">
    <xbrli:entity>
      <xbrli:identifier scheme="http://www.sec.gov/CIK">0001000000</xbrli:identifier>
    </xbrli:entity>
    <xbrli:period>
      <xbrli:startDate>2014-01-01</xbrli:startDate>
      <xbrli:endDate>2014-12-31</xbrli:endDate>
    </xbrli:period>
  </xbrli:context>
  <xbrli:context id="I2014">
    <xbrli:entity>
      <xbrli:identifier scheme="http://www.sec.gov/CIK">0001000000</xbrli:identifier>
    </xbrli:entity>
    <xbrli:period><xbrli:instant>2014-12-31</xbrli:instant></xbrli:period>
  </xbrli:context>
  <xbrli:unit id="USD"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
  <dei:DocumentType contextRef="D2014">S-1</dei:DocumentType>
  <dei:EntityRegistrantName contextRef="D2014">Example Corp</dei:EntityRegistrantName>
  <us-gaap:CashAndCashEquivalentsAtCarryingValue contextRef="I2014" unitRef="USD" decimals="0">2500000</us-gaap:CashAndCashEquivalentsAtCarryingValue>
  <us-gaap:AccruedLiabilitiesCurrent contextRef="I2014" unitRef="USD" decimals="0" xsi:nil="true"/>
</xbrli:xbrl>`;

describe("parseXbrlInstance", () => {
  it("returns hasXbrl=false for non-XBRL XML", () => {
    const result = parseXbrlInstance(`<?xml version="1.0"?><edgarSubmission></edgarSubmission>`);
    expect(result.hasXbrl).toBe(false);
  });

  it("parses contexts, units, and facts from an instance document", () => {
    const result = parseXbrlInstance(INSTANCE);
    expect(result.hasXbrl).toBe(true);
    expect(result.contexts.size).toBe(2);
    expect(result.contexts.get("I2014")?.periodInstant).toBe("2014-12-31");
    expect(result.units.get("USD")?.measure).toBe("USD");

    expect(result.facts).toHaveLength(4);
    const name = result.facts.find((f) => f.concept === "dei:EntityRegistrantName")!;
    expect(name.value).toBe("Example Corp");
    expect(name.isNumeric).toBe(false);
    expect(name.namespace).toBe("http://xbrl.sec.gov/dei/2014-01-31");
    expect(name.source).toBe("instance");

    const cash = result.facts.find((f) =>
      f.concept.endsWith("CashAndCashEquivalentsAtCarryingValue")
    )!;
    expect(cash.numericValue).toBe(2500000);
    expect(cash.unitRef).toBe("USD");
    expect(cash.contextRef).toBe("I2014");

    const nil = result.facts.find((f) => f.concept.endsWith("AccruedLiabilitiesCurrent"))!;
    expect(nil.isNil).toBe(true);
    expect(nil.numericValue).toBeNull();
  });
});
