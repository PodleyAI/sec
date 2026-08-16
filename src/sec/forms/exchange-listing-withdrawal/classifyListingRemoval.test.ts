/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  classifyListingRemoval,
  UNIT_SEPARATION_MAX_DAYS_AFTER_IPO,
} from "./classifyListingRemoval";

const base = {
  ipoDate: "2026-05-21",
  filingDate: "2026-06-09",
};

describe("classifyListingRemoval", () => {
  it("treats a 25-NSE shortly after IPO as unit separation", () => {
    // Aperture AC: IPO 2026-05-21, Nasdaq 25-NSE 2026-06-09 (19 days).
    expect(classifyListingRemoval({ ...base, form: "25-NSE" })).toBe("unit_split");
  });

  it("includes the day bound and not the day after", () => {
    expect(
      classifyListingRemoval({
        form: "25-NSE",
        ipoDate: "2026-01-01",
        filingDate: "2026-06-30",
      })
    ).toBe("unit_split");
    expect(
      classifyListingRemoval({
        form: "25-NSE",
        ipoDate: "2026-01-01",
        filingDate: "2026-07-01",
      })
    ).toBe("deregistration");
    expect(UNIT_SEPARATION_MAX_DAYS_AFTER_IPO).toBe(180);
  });

  it("treats a 25-NSE well after IPO as deregistration", () => {
    expect(
      classifyListingRemoval({
        form: "25-NSE",
        ipoDate: "2021-01-19",
        filingDate: "2023-09-25",
      })
    ).toBe("deregistration");
  });

  it("does not treat a 25-NSE as unit separation when the vehicle never IPO'd", () => {
    expect(
      classifyListingRemoval({
        form: "25-NSE",
        ipoDate: null,
        filingDate: "2026-06-09",
      })
    ).toBe("deregistration");
  });

  it("treats issuer Form 25 as deregistration even right after IPO", () => {
    expect(classifyListingRemoval({ ...base, form: "25" })).toBe("deregistration");
  });

  it("treats Form 15 as deregistration", () => {
    expect(classifyListingRemoval({ ...base, form: "15-12G" })).toBe("deregistration");
  });

  it("treats a second 25-NSE still inside the IPO window as unit separation", () => {
    // Westin: IPO 2025-11-05, first Nasdaq 25-NSE 2025-12-30, second 2026-01-06.
    expect(
      classifyListingRemoval({
        form: "25-NSE",
        ipoDate: "2025-11-05",
        filingDate: "2026-01-06",
      })
    ).toBe("unit_split");
  });

  it("classifies 25-NSE/A the same as 25-NSE", () => {
    expect(classifyListingRemoval({ ...base, form: "25-NSE/A" })).toBe("unit_split");
  });
});
