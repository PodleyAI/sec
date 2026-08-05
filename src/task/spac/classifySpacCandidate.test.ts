/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  classifySpacCandidate,
  looksLikeBlankCheckName,
  type SpacCandidateFacts,
} from "./classifySpacCandidate";

const AT = "2026-08-02T12:00:00.000Z";

const facts = (over: Partial<SpacCandidateFacts>): SpacCandidateFacts => ({
  cik: 1,
  name: null,
  current_sic: null,
  first_reg_form: null,
  first_reg_date: null,
  renamed_from: null,
  spac_name_ended: null,
  ...over,
});

describe("looksLikeBlankCheckName", () => {
  it("matches the shapes sponsors actually use", () => {
    expect(looksLikeBlankCheckName("Churchill Capital Corp IV")).toBe(false);
    expect(looksLikeBlankCheckName("Diamond Eagle Acquisition Corp. \\ DE")).toBe(true);
    expect(looksLikeBlankCheckName("GS Acquisition Holdings Corp")).toBe(true);
    expect(looksLikeBlankCheckName("BEST SPAC I Acquistion Corp.")).toBe(false);
  });

  it("does not match an LBO vehicle that merely contains 'acquisition'", () => {
    // A bare "%acquisition%" would sweep these in; they are partnerships and
    // LLCs, which a blank check never is.
    expect(looksLikeBlankCheckName("RIFKIN ACQUISITION PARTNERS LLLP")).toBe(false);
    expect(looksLikeBlankCheckName("Inergy Acquisition Company, LLC")).toBe(false);
  });

  it("keeps a sponsor-branded 'Partners' SPAC — only the LP/LLC legal forms are excluded", () => {
    // 12 of the 13 registrants matching "acquisition" + "partners" without an
    // LP/LLC suffix are coded 6770, so a bare "partners" must not disqualify.
    expect(looksLikeBlankCheckName("Supernova Partners Acquisition Co III, Ltd.")).toBe(true);
    expect(looksLikeBlankCheckName("Catalyst Partners Acquisition Corp.")).toBe(true);
  });

  it("matches the non-'acquisition' naming conventions measured against SIC 6770", () => {
    expect(looksLikeBlankCheckName("Corsair Partnering Corp")).toBe(true);
    expect(looksLikeBlankCheckName("Elliott Opportunity II Corp.")).toBe(true);
    expect(looksLikeBlankCheckName("Orion Biotech Opportunities Corp.")).toBe(true);
    expect(looksLikeBlankCheckName("Juniper Growth CORP")).toBe(true);
    expect(looksLikeBlankCheckName("Legato Merger Corp.")).toBe(true);
  });

  it("rejects the naming conventions that measured as mostly-not-SPAC", () => {
    // "Capital Corp" is 31/99 among registrants: lenders, BDCs, and insurers.
    expect(looksLikeBlankCheckName("BBX CAPITAL CORP")).toBe(false);
    expect(looksLikeBlankCheckName("SPRINT CAPITAL CORP")).toBe(false);
    expect(looksLikeBlankCheckName("MGIC INVESTMENT CORP")).toBe(false);
    expect(looksLikeBlankCheckName("Cherry Hill Mortgage Investment Corp")).toBe(false);
    // Substring "spac" inside an unrelated word must not match.
    expect(looksLikeBlankCheckName("SPACEHAB INC")).toBe(false);
  });

  it("is null-safe", () => {
    expect(looksLikeBlankCheckName(null)).toBe(false);
    expect(looksLikeBlankCheckName("")).toBe(false);
  });
});

describe("classifySpacCandidate", () => {
  it("returns null when no signal fires", () => {
    expect(classifySpacCandidate(facts({ name: "Apple Inc.", current_sic: 3571 }), AT)).toBeNull();
  });

  it("grades a weak-named SPAC high when EDGAR also codes it a blank check", () => {
    // "... Capital Corp" is a weak pattern on its own, but 6770 plus a
    // registration under that name settles it.
    const row = classifySpacCandidate(
      facts({
        cik: 1812234,
        name: "Churchill Capital Corp V",
        current_sic: 6770,
        first_reg_form: "S-1",
        first_reg_date: "2020-09-22",
      }),
      AT
    );
    expect(row).toMatchObject({
      confidence: "high",
      signal_sic_6770: true,
      // The schema's name signal tracks the STRONG class only.
      signal_name_match: false,
      reg_while_spac_named: true,
    });
  });

  it("caps a weak name with no other evidence at medium — lenders are named this way too", () => {
    // Over all vintages "%capital corp%" is 32% SPACs; the rest are lenders,
    // BDCs and insurers, and nothing here says otherwise.
    for (const name of ["BBX CAPITAL CORP", "Cherry Hill Mortgage Investment Corp"]) {
      const row = classifySpacCandidate(
        facts({
          cik: 921768,
          name,
          current_sic: 6500,
          first_reg_form: "S-1",
          first_reg_date: "2010-09-03",
        }),
        AT
      );
      expect(row).toMatchObject({ confidence: "medium", signal_name_match: false });
    }
  });

  it("recovers a de-SPAC whose SPAC-era name only matched the weak class", () => {
    // Capitol Investment Corp. V -> Doma Holdings: no "acquisition" anywhere,
    // and the SIC is long gone. Found, but held at medium.
    const row = classifySpacCandidate(
      facts({
        cik: 1722438,
        name: "Doma Holdings, Inc.",
        current_sic: 6361,
        first_reg_form: "S-1",
        first_reg_date: "2019-11-08",
        renamed_from: "Capitol Investment Corp. V",
        spac_name_ended: "2021-07-28T00:00:00.000Z",
      }),
      AT
    );
    expect(row).toMatchObject({
      confidence: "medium",
      signal_renamed_from: "Capitol Investment Corp. V",
    });
  });

  it("grades a live SPAC that is both coded and named like one high", () => {
    const row = classifySpacCandidate(
      facts({
        cik: 2082251,
        name: "Yuanxiang Acquisition Corp.",
        current_sic: 6770,
        first_reg_form: "F-1",
        first_reg_date: "2025-09-17",
      }),
      AT
    );
    expect(row).toMatchObject({
      confidence: "high",
      signal_sic_6770: true,
      signal_name_match: true,
      reg_while_spac_named: true,
    });
  });

  it("grades a de-SPAC high off its name history, even though the SIC moved on", () => {
    // DraftKings: SIC reads 7990 today, so a `sic = 6770` query misses it. The
    // S-1 it filed as Diamond Eagle is what makes it a SPAC.
    const row = classifySpacCandidate(
      facts({
        cik: 1772757,
        name: "DraftKings Holdings Inc.",
        current_sic: 7990,
        first_reg_form: "S-1",
        first_reg_date: "2019-04-11",
        renamed_from: "Diamond Eagle Acquisition Corp. \\ DE",
        spac_name_ended: "2020-04-23T00:00:00.000Z",
      }),
      AT
    );
    expect(row).toMatchObject({
      confidence: "high",
      signal_sic_6770: false,
      signal_renamed_from: "Diamond Eagle Acquisition Corp. \\ DE",
      reg_while_spac_named: true,
    });
  });

  it("grades a Form 10 shell low — its registration came only after the rename", () => {
    // CIK 1348155: registered on 10SB12G as R&R ACQUISITION I, reverse-merged,
    // then filed an S-1 as Global Employment Holdings. Not a SPAC.
    const row = classifySpacCandidate(
      facts({
        cik: 1348155,
        name: "Global Employment Holdings, Inc.",
        current_sic: 7363,
        first_reg_form: "S-1",
        first_reg_date: "2006-05-01",
        renamed_from: "R&R ACQUISITION I, INC",
        spac_name_ended: "2006-03-28T00:00:00.000Z",
      }),
      AT
    );
    expect(row).toMatchObject({ confidence: "low", reg_while_spac_named: false });
  });

  it("grades a 6770 filer that registered after shedding a blank-check name medium", () => {
    // Still coded a blank check, but the registration came after the rename —
    // the one shape that argues against a SPAC.
    const row = classifySpacCandidate(
      facts({
        cik: 1084870,
        name: "AMERICOM USA INC",
        current_sic: 6770,
        first_reg_form: "S-1",
        first_reg_date: "2001-06-01",
        renamed_from: "CHATSWORTH ACQUISITION CORP",
        spac_name_ended: "1999-04-12T00:00:00.000Z",
      }),
      AT
    );
    expect(row).toMatchObject({ confidence: "medium", reg_while_spac_named: false });
  });

  it("grades a 6770 filer with a registration and no name evidence high", () => {
    const row = classifySpacCandidate(
      facts({
        cik: 837472,
        name: "BOUNDLESS CORP",
        current_sic: 6770,
        first_reg_form: "S-1",
        first_reg_date: "1996-05-30",
      }),
      AT
    );
    // EDGAR's own blank-check coding plus a registration, with nothing arguing
    // against it — measured at 89% against embarc's list for this shape.
    expect(row).toMatchObject({
      confidence: "high",
      signal_name_match: false,
      reg_while_spac_named: null,
    });
  });

  it("keeps a still-named SPAC high when its SIC has drifted or is missing", () => {
    // Melar reads 7389 in `entities` while its S-1 header says 6770; Viking has
    // no SIC at all. The name plus the registration still carry the call.
    for (const sic of [7389, null]) {
      const row = classifySpacCandidate(
        facts({
          cik: 2016221,
          name: "Melar Acquisition Corp. I/Cayman",
          current_sic: sic,
          first_reg_form: "DRS",
          first_reg_date: "2024-04-05",
        }),
        AT
      );
      expect(row).toMatchObject({
        confidence: "high",
        signal_name_match: true,
        reg_while_spac_named: true,
      });
    }
  });

  it("returns null for a blank-check-shaped name with no registration and no 6770 coding", () => {
    // A private acquisition vehicle or dormant shell: named like a SPAC, but
    // nothing in EDGAR backs that up.
    expect(
      classifySpacCandidate(
        facts({ cik: 1167729, name: "SINCLAIR ACQUISITION VIII INC", current_sic: null }),
        AT
      )
    ).toBeNull();
  });

  it("grades a blank check with no registration on file low", () => {
    const row = classifySpacCandidate(
      facts({ cik: 42, name: "Someone Acquisition Corp", current_sic: 6770 }),
      AT
    );
    expect(row).toMatchObject({ confidence: "low", reg_while_spac_named: null });
  });

  it("uses the LAST blank-check-named interval, so a cosmetic rename does not demote", () => {
    // Chardan Healthcare Acquisition 2 Corp has an early interval that ends
    // while it is still a SPAC (punctuation change). Passing the last one keeps
    // the IPO registration inside the blank-check era.
    const row = classifySpacCandidate(
      facts({
        cik: 1770141,
        name: "Renovacor, Inc.",
        current_sic: 2836,
        first_reg_form: "S-1",
        first_reg_date: "2020-03-09",
        renamed_from: "Chardan Healthcare Acquisition 2 Corp",
        spac_name_ended: "2021-09-02T00:00:00.000Z",
      }),
      AT
    );
    expect(row).toMatchObject({ confidence: "high", reg_while_spac_named: true });
  });

  it("keeps a still-blank-check-named SPAC high when an EARLIER interval closed before the registration", () => {
    // The company still calls itself "Ajax Acquisition Corp" today, so it never
    // renamed away from the blank-check name — an earlier closed interval is a
    // cosmetic variant or a pre-IPO sponsor rebrand, not a de-SPAC.
    const row = classifySpacCandidate(
      facts({
        cik: 9001,
        name: "Ajax Acquisition Corp",
        current_sic: 7389,
        first_reg_form: "S-1",
        first_reg_date: "2021-06-01",
        renamed_from: "Ajax Capital Acquisitions Corp",
        spac_name_ended: "2021-01-15T00:00:00.000Z",
      }),
      AT
    );
    expect(row).toMatchObject({
      confidence: "high",
      signal_name_match: true,
      reg_while_spac_named: true,
    });
  });

  it("does not let the current-name check promote a weak-class name past medium", () => {
    // Same shape, but both names only match the weak class. The current name
    // must still count as "never renamed away", yet stay capped at medium.
    const row = classifySpacCandidate(
      facts({
        cik: 9001,
        name: "Ajax Capital Corp",
        current_sic: 7389,
        first_reg_form: "S-1",
        first_reg_date: "2021-06-01",
        renamed_from: "Ajax Capital Investment Corp",
        spac_name_ended: "2021-01-15T00:00:00.000Z",
      }),
      AT
    );
    expect(row).toMatchObject({ confidence: "medium", reg_while_spac_named: true });
  });
});
