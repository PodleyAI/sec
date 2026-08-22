/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { S1_SECTIONS, SECTION_HEADING_PATTERNS } from "./DocumentSegmenter";
import { lockupParseText, offeringSectionNames } from "./offeringSections";
import { LOCKUP_ANCHORS, LOCKUP_HOLDER_CLASSES, LockupOutputSchema } from "./lockupSchema";
import { lockupInstructions } from "./sectionExtractors";

const matches = (line: string): boolean =>
  SECTION_HEADING_PATTERNS[S1_SECTIONS.LOCK_UP].some((re) => re.test(line));

describe("lock-up section headings", () => {
  it.each([
    "Shares Eligible for Future Sale",
    "SHARES ELIGIBLE FOR FUTURE SALE",
    "Ordinary Shares Eligible for Future Sale",
    "Lock-Up Agreements",
    "Lockup Agreement",
    "Lock-up",
  ])("accepts %s", (line) => {
    expect(matches(line)).toBe(true);
  });

  it.each([
    // Whole-line anchored, so body prose naming a lock-up is not a heading —
    // every one of the 32 fixtures that discloses a lock-up says the word in
    // running text, and matching those would slice the section at a sentence.
    "Our sponsor has agreed to a lock-up of its founder shares.",
    "The lock-up agreements are described below.",
    "Shares Eligible for Future Sale and Rule 144",
    "Underwriting",
  ])("rejects %s", (line) => {
    expect(matches(line)).toBe(false);
  });
});

describe("lockupParseText", () => {
  it("reads the Item 12 section first, then Underwriting", () => {
    const text = lockupParseText(
      new Map([
        [S1_SECTIONS.LOCK_UP, "item twelve body"],
        [S1_SECTIONS.UNDERWRITING, "underwriting body"],
      ])
    );
    expect(text).toBe("item twelve body\n\nunderwriting body");
  });

  it("falls back to Underwriting alone", () => {
    // 14 of the 42 committed fixtures carry the Item 12 heading and 32 disclose
    // a lock-up, so the dedicated heading cannot be the only way in.
    expect(lockupParseText(new Map([[S1_SECTIONS.UNDERWRITING, "underwriting body"]]))).toBe(
      "underwriting body"
    );
  });

  it("yields an empty string when neither section resolved", () => {
    // Which `runSection` reads as "section not found" rather than as an empty
    // document it should send to a model.
    expect(lockupParseText(new Map())).toBe("");
  });
});

describe("offeringSectionNames", () => {
  it("includes lockups for a SPAC and a non-SPAC alike", () => {
    // Unlike `sponsor-promote`, every registrant locks somebody up, so this
    // section is never skipped — and a name that is never skipped is safe to
    // dead-letter under for either kind of filing.
    expect(offeringSectionNames(true)).toContain("lockups");
    expect(offeringSectionNames(false)).toContain("lockups");
  });
});

describe("LockupOutputSchema", () => {
  it("requires a holder class and a citation on every row", () => {
    const item = LockupOutputSchema.properties.lockups.items;
    expect(item.required).toEqual(["holder_class", "confidence", "source_span"]);
  });

  it("constrains holder_class and anchor_event to their vocabularies", () => {
    // A lock-up filed under a class nothing downstream knows is a restriction
    // nobody will ever evaluate, so the schema states the vocabulary rather
    // than leaving it to the prompt.
    const item = LockupOutputSchema.properties.lockups.items;
    expect(item.properties.holder_class.enum).toEqual([...LOCKUP_HOLDER_CLASSES]);
    expect(item.properties.anchor_event.enum).toEqual([...LOCKUP_ANCHORS, null]);
  });

  it("leaves every term nullable, since filers state different subsets", () => {
    const item = LockupOutputSchema.properties.lockups.items;
    for (const key of [
      "duration_days",
      "price_trigger",
      "trigger_days_at_or_above",
      "trigger_window_days",
      "trigger_start_delay_days",
    ] as const) {
      expect(item.properties[key].type, key).toEqual(["number", "null"]);
    }
  });
});

describe("lockupInstructions", () => {
  it("tells the model a duration and a price test are one lock-up, not two", () => {
    // The single most likely misreading: "one year, or earlier if the shares
    // trade at or above $12.00" describes alternatives on one restriction.
    expect(lockupInstructions()).toMatch(/ALTERNATIVES on one lock-up, not two/);
  });

  it("asks for days rather than a phrase, and names the conversions", () => {
    expect(lockupInstructions()).toMatch(/six months is 180, one year is 365/);
  });

  it("forbids assuming a customary term the filing omits", () => {
    expect(lockupInstructions()).toMatch(/do not assume a customary term the filing omits/);
  });
});
