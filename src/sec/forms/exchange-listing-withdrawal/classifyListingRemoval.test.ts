/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  classifyListingRemoval,
  isNearby20F,
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

  it("does not demote a 25-NSE when the IPO floor is unknown", () => {
    // A SPAC minted by the S-1 AI content classifier (a SIC-miscoded filer)
    // structurally never gets an ipo_date, so demoting on an absent floor
    // marked a live searching vehicle liquidated.
    for (const ipoDate of [null, ""]) {
      expect(
        classifyListingRemoval({
          form: "25-NSE",
          ipoDate,
          filingDate: "2026-06-09",
        })
      ).toBe("unit_split");
      expect(
        classifyListingRemoval({
          form: "25-NSE/A",
          ipoDate,
          filingDate: "2026-06-09",
        })
      ).toBe("unit_split");
    }
  });

  it("still deregisters an issuer Form 25 / Form 15 with an unknown IPO floor", () => {
    // The unknown-floor allowance is exchange-only: a real wind-up files one of
    // these, so the conservative branch loses very little.
    for (const form of ["25", "25/A", "15-12G", "15-12B", "15F-12G"]) {
      expect(classifyListingRemoval({ form, ipoDate: null, filingDate: "2026-06-09" })).toBe(
        "deregistration"
      );
    }
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

  it("treats Form 15 after an earlier completed close as housekeeping, not a new liquidation", () => {
    // Replay order: 25-NSE becomes `completed` first, so Form 15 no longer sees
    // a pending deal. The listing removal is still post-close paperwork.
    expect(
      classifyListingRemoval({
        form: "15-12G",
        ipoDate: "2024-11-08",
        filingDate: "2026-06-09",
        pendingDeal: null,
        hasPriorCompleted: true,
      })
    ).toBe("completed");
  });

  it("treats Form 15 after a vote as completed close, not liquidation (Columbus Circle)", () => {
    expect(
      classifyListingRemoval({
        form: "15-12G",
        ipoDate: "2025-06-01",
        filingDate: "2025-12-22",
        pendingDeal: { vote_date: "2025-12-03", proxy_date: "2025-11-12" },
      })
    ).toBe("completed");
  });

  it("treats a 25-NSE after a vote as completed even inside the unit-split window", () => {
    // Fast de-SPAC: close-day 25-NSE would otherwise look like unit separation.
    expect(
      classifyListingRemoval({
        form: "25-NSE",
        ipoDate: "2025-08-01",
        filingDate: "2025-12-05",
        pendingDeal: { vote_date: "2025-12-03", proxy_date: null },
      })
    ).toBe("completed");
  });

  it("treats a 25-NSE after a proxy (no vote yet, 14C) as completed", () => {
    expect(
      classifyListingRemoval({
        form: "25-NSE",
        ipoDate: "2025-08-01",
        filingDate: "2026-07-10",
        pendingDeal: { vote_date: null, proxy_date: "2026-07-07" },
      })
    ).toBe("completed");
  });

  it("does not complete on a pending DA that never reached proxy or vote", () => {
    expect(
      classifyListingRemoval({
        form: "25-NSE",
        ipoDate: "2021-01-19",
        filingDate: "2023-09-25",
        pendingDeal: { vote_date: null, proxy_date: null },
      })
    ).toBe("deregistration");
  });

  it("treats a 25-NSE with a nearby 20-F as FPI close (Spring Valley III)", () => {
    expect(
      classifyListingRemoval({
        form: "25-NSE",
        ipoDate: "2025-09-04",
        filingDate: "2026-07-10",
        pendingDeal: null,
        hasNearby20F: true,
      })
    ).toBe("completed");
  });

  it("does not let a nearby 20-F override unit separation shortly after IPO", () => {
    expect(
      classifyListingRemoval({
        ...base,
        form: "25-NSE",
        pendingDeal: null,
        hasNearby20F: true,
      })
    ).toBe("unit_split");
  });

  it("lets a nearby 20-F win over the unknown-floor allowance", () => {
    // Both branches accept this filing, and the FPI close is the truthful one:
    // an FPI close carries no ipo_date either, so granting the unknown floor a
    // unit_split first would misfile every miscoded FPI close as a separation.
    // This is why the allowance sits after the 20-F check rather than inside
    // the post-IPO window test.
    for (const ipoDate of [null, ""]) {
      expect(
        classifyListingRemoval({
          form: "25-NSE",
          ipoDate,
          filingDate: "2026-07-10",
          pendingDeal: null,
          hasNearby20F: true,
        })
      ).toBe("completed");
    }
  });

  it("does not complete a 25-NSE when the voted deal is no longer pending (Evergreen)", () => {
    expect(
      classifyListingRemoval({
        form: "25-NSE",
        ipoDate: "2022-02-10",
        filingDate: "2025-06-20",
        pendingDeal: null,
      })
    ).toBe("deregistration");
  });

  it("treats a 20-F after a vote as FPI close, not an annual report", () => {
    expect(
      classifyListingRemoval({
        form: "20-F",
        ipoDate: "2025-09-04",
        filingDate: "2026-07-16",
        pendingDeal: { vote_date: "2026-07-06", proxy_date: null },
      })
    ).toBe("completed");
  });

  it("treats a 20-F with a nearby 25-NSE as FPI close (Spring Valley III)", () => {
    expect(
      classifyListingRemoval({
        form: "20-F",
        ipoDate: "2025-09-04",
        filingDate: "2026-07-16",
        pendingDeal: null,
        hasNearby25Nse: true,
      })
    ).toBe("completed");
  });

  it("treats the first 20-F after an F-4 as FPI close (NewGenIvf)", () => {
    expect(
      classifyListingRemoval({
        form: "20-F",
        ipoDate: null,
        filingDate: "2024-04-09",
        pendingDeal: null,
        isFirst20FAfterCombination: true,
      })
    ).toBe("completed");
  });

  it("ignores an annual 20-F with no close signal", () => {
    expect(
      classifyListingRemoval({
        form: "20-F",
        ipoDate: "2025-09-04",
        filingDate: "2026-03-31",
        pendingDeal: null,
        hasNearby25Nse: false,
        isFirst20FAfterCombination: false,
      })
    ).toBe("ignore");
  });

  it("keeps the unknown-floor allowance when no 20-F is nearby", () => {
    // The negative twin of the case above: with the 20-F absent the allowance
    // is reachable, so the ordering costs the SIC-miscoded SPAC nothing.
    expect(
      classifyListingRemoval({
        form: "25-NSE",
        ipoDate: null,
        filingDate: "2026-07-10",
        pendingDeal: null,
        hasNearby20F: false,
      })
    ).toBe("unit_split");
  });
});

describe("isNearby20F", () => {
  it("includes a 20-F six days after the 25-NSE (Spring Valley III)", () => {
    expect(isNearby20F("2026-07-10", "2026-07-16")).toBe(true);
  });

  it("includes the day bound and not the day after", () => {
    expect(isNearby20F("2026-07-10", "2026-07-24")).toBe(true);
    expect(isNearby20F("2026-07-10", "2026-07-25")).toBe(false);
  });
});
