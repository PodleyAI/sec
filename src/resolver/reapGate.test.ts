/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { hasBlockingSectionFailure, type ReapGateDeadLetter } from "./reapStaleObservations";

const ACC = "0000000000-26-000001";
const RUN_START = "2026-06-27T12:00:00.000Z";
const FRESH = "2026-06-27T12:00:05.000Z"; // >= RUN_START
const STALE = "2026-06-26T00:00:00.000Z"; // < RUN_START

function dl(partial: Partial<ReapGateDeadLetter>): ReapGateDeadLetter {
  return {
    accession_number: ACC,
    reason_code: "MODEL_INVALID_OUTPUT",
    section_name: "management",
    last_attempt_at: FRESH,
    ...partial,
  };
}

describe("hasBlockingSectionFailure", () => {
  it("blocks on every fresh zero-row failure code", () => {
    for (const reason_code of [
      "MODEL_INVALID_OUTPUT",
      "MODEL_EMPTY",
      "LOW_CONFIDENCE_ALL",
      "UNVERIFIED_SOURCE_SPAN",
    ]) {
      expect(hasBlockingSectionFailure([dl({ reason_code })], ACC, RUN_START)).toBe(true);
    }
  });

  it("does NOT block on a genuinely-absent section (SECTION_NOT_FOUND)", () => {
    // Common case — most filings lack some optional section; blocking here would
    // disable the reaper entirely.
    expect(
      hasBlockingSectionFailure([dl({ reason_code: "SECTION_NOT_FOUND" })], ACC, RUN_START)
    ).toBe(false);
  });

  it("does NOT block on a partial-success marker (section persisted its rows)", () => {
    expect(
      hasBlockingSectionFailure(
        [dl({ reason_code: "UNVERIFIED_SOURCE_SPAN", section_name: "underwriters-partial" })],
        ACC,
        RUN_START
      )
    ).toBe(false);
  });

  it("ignores stale dead-letters from a prior run", () => {
    // A persistently-absent section must not pin the reaper forever once the
    // failure is no longer being re-recorded this run.
    expect(hasBlockingSectionFailure([dl({ last_attempt_at: STALE })], ACC, RUN_START)).toBe(false);
  });

  it("ignores dead-letters for a different accession", () => {
    expect(
      hasBlockingSectionFailure([dl({ accession_number: "9999999999-99-999999" })], ACC, RUN_START)
    ).toBe(false);
  });

  it("blocks when ANY fresh failing section is present among benign ones", () => {
    const entries = [
      dl({ reason_code: "SECTION_NOT_FOUND", section_name: "underwriting" }),
      dl({ reason_code: "UNVERIFIED_SOURCE_SPAN", section_name: "management-partial" }),
      dl({ reason_code: "MODEL_EMPTY", section_name: "related-party" }),
    ];
    expect(hasBlockingSectionFailure(entries, ACC, RUN_START)).toBe(true);
  });

  it("returns false for an empty dead-letter set (clean run)", () => {
    expect(hasBlockingSectionFailure([], ACC, RUN_START)).toBe(false);
  });
});
