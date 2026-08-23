/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { cleanListedTickers, normalizeListedTicker } from "./listedTicker";

describe("normalizeListedTicker", () => {
  it("keeps exact CBOE and BATS", () => {
    expect(normalizeListedTicker("CBOE")).toBe("CBOE");
    expect(normalizeListedTicker("BATS")).toBe("BATS");
  });

  it("strips a delimited exchange prefix", () => {
    expect(normalizeListedTicker("CBOE:XYZ")).toBe("XYZ");
    expect(normalizeListedTicker("BATS_XYZ")).toBe("XYZ");
    expect(normalizeListedTicker("CBOE CMAQ")).toBe("CMAQ");
    expect(normalizeListedTicker("NASDAQ:CMAQ")).toBe("CMAQ");
    expect(normalizeListedTicker("NYSE_CMAQ")).toBe("CMAQ");
  });

  it("does not strip a prefix with no delimiter", () => {
    expect(normalizeListedTicker("CBOECMAQ")).toBeNull();
    expect(normalizeListedTicker("NASDAQCMAQ")).toBeNull();
  });

  it("treats underscores after OTCBB as the delimiter", () => {
    expect(normalizeListedTicker("OTCBB___")).toBeNull();
  });

  it("unwraps and trims wrappers", () => {
    expect(normalizeListedTicker("(CMAQ)")).toBe("CMAQ");
    expect(normalizeListedTicker("*(CMAQ)")).toBe("CMAQ");
    expect(normalizeListedTicker("*( CMAQ )")).toBe("CMAQ");
    expect(normalizeListedTicker("* BTC.U")).toBe("BTC.U");
  });

  it("rejects unbalanced parentheses", () => {
    expect(normalizeListedTicker("(CMAQ")).toBeNull();
    expect(normalizeListedTicker("CMAQ)")).toBeNull();
  });

  it("accepts listed suffixes", () => {
    expect(normalizeListedTicker("CMAQ.U")).toBe("CMAQ.U");
    expect(normalizeListedTicker("CMAQU")).toBe("CMAQU");
    expect(normalizeListedTicker("CMAQ.WS")).toBe("CMAQ.WS");
    expect(normalizeListedTicker("CMAQW")).toBe("CMAQW");
    expect(normalizeListedTicker("CMAQ.RT")).toBe("CMAQ.RT");
    expect(normalizeListedTicker("CMAQR")).toBe("CMAQR");
    expect(normalizeListedTicker("CMAQ.WT")).toBe("CMAQ.WT");
    expect(normalizeListedTicker("GSAH U")).toBe("GSAH U");
  });

  it("drops placeholders", () => {
    expect(normalizeListedTicker("N/A")).toBeNull();
    expect(normalizeListedTicker("NONE")).toBeNull();
    expect(normalizeListedTicker("NOT AVAIL.")).toBeNull();
  });
});

describe("cleanListedTickers", () => {
  it("dedupes after cleaning", () => {
    expect(cleanListedTickers(["(CMAQ)", "NASDAQ:CMAQ", "NONE"])).toEqual(["CMAQ"]);
  });
});
