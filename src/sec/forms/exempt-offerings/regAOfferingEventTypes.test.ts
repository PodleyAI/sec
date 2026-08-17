/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  classifyRegAOfferingEvent,
  REGA_OFFERING_EVENT_TYPES,
} from "./regAOfferingEventTypes";

describe("classifyRegAOfferingEvent", () => {
  it("groups all four 253G subsections as one supplement event", () => {
    // Which of Rule 253(g)(1)-(4) a filer chose is a reading of the rule, not
    // something the filing asserts. The row keeps the exact `form`, so a finer
    // classification stays derivable without re-extracting.
    for (const form of ["253G1", "253G2", "253G3", "253G4"]) {
      expect(classifyRegAOfferingEvent(form)).toBe("circular_supplement");
    }
  });

  it("keeps the two withdrawal families apart", () => {
    // They end opposite things: 1-A-W withdraws the OFFERING (it never
    // happens), 1-Z-W withdraws the EXIT report (the offering is not over after
    // all). Collapsing them into one "withdrawn" event inverts one of them.
    expect(classifyRegAOfferingEvent("1-A-W")).toBe("offering_withdrawn");
    expect(classifyRegAOfferingEvent("1-Z-W")).toBe("exit_report_withdrawn");
  });

  it("classifies amendments as their base event", () => {
    expect(classifyRegAOfferingEvent("1-A-W/A")).toBe("offering_withdrawn");
    expect(classifyRegAOfferingEvent("1-Z-W/A")).toBe("exit_report_withdrawn");
  });

  it("tolerates case and surrounding whitespace", () => {
    expect(classifyRegAOfferingEvent(" 253g2 ")).toBe("circular_supplement");
    expect(classifyRegAOfferingEvent("1-a-w")).toBe("offering_withdrawn");
  });

  it("returns undefined for a form it does not handle, rather than guessing", () => {
    // Reaching the storage handler with one of these means the dispatch and
    // this map disagree — a wiring error no retry fixes. Defaulting would file
    // it under a meaning nobody chose and hide the fault behind plausible rows.
    expect(classifyRegAOfferingEvent("1-K")).toBeUndefined();
    expect(classifyRegAOfferingEvent("253G5")).toBeUndefined();
    expect(classifyRegAOfferingEvent("")).toBeUndefined();
  });

  it("covers every event form present in the corpus", () => {
    // The live distribution: 253G2 5,016 · 1-A-W 493 · 253G1 237 · 253G3 66 ·
    // 1-A-W/A 50 · 253G4 6 · 1-Z-W 6.
    for (const form of ["253G1", "253G2", "253G3", "253G4", "1-A-W", "1-A-W/A", "1-Z-W"]) {
      expect(
        REGA_OFFERING_EVENT_TYPES[form as keyof typeof REGA_OFFERING_EVENT_TYPES],
        `form ${form} is unmapped`
      ).toBeDefined();
    }
  });
});
