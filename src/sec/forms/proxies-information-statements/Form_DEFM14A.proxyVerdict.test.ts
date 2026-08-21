/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { resolveProxyEventVerdict } from "./Form_DEFM14A.storage";

/** Defaults for a run that reached the model and extracted a deal. */
const extracted = { extractedDeal: true, concludedNoDeal: false } as const;
/** A run that read the section and concluded the filing discloses no deal. */
const noDeal = { extractedDeal: false, concludedNoDeal: true } as const;
/** A run that failed before reaching an answer (no model, throttle, catch-all). */
const noAnswer = { extractedDeal: false, concludedNoDeal: false } as const;

describe("resolveProxyEventVerdict", () => {
  it("emits for a definitive merger statement on the form symbol alone", () => {
    for (const form of ["DEFM14A", "DEFM14C"]) {
      expect(resolveProxyEventVerdict({ form, ...noAnswer, seeksCombinationApproval: null })).toBe(
        "emit"
      );
    }
  });

  it("never emits for a preliminary or revised statement", () => {
    for (const form of ["PREM14A", "PREM14C", "PRER14A", "DEFR14A", "PRE 14A"]) {
      expect(resolveProxyEventVerdict({ form, ...extracted, seeksCombinationApproval: true })).toBe(
        "retract"
      );
    }
  });

  it("emits for a general definitive statement only on both pieces of evidence", () => {
    expect(
      resolveProxyEventVerdict({ form: "DEF 14A", ...extracted, seeksCombinationApproval: true })
    ).toBe("emit");
    expect(
      resolveProxyEventVerdict({ form: "DEF 14A", ...noDeal, seeksCombinationApproval: true })
    ).toBe("retract");
    expect(
      resolveProxyEventVerdict({ form: "DEF 14A", ...extracted, seeksCombinationApproval: false })
    ).toBe("retract");
  });

  it("leaves the event alone when the run reached no verdict about the document", () => {
    // The invariant: a failed extraction is not evidence that this filing is
    // not a merger proxy, so it must not delete an event an earlier run wrote.
    expect(
      resolveProxyEventVerdict({ form: "DEF 14A", ...noAnswer, seeksCombinationApproval: true })
    ).toBe("leave");
    expect(
      resolveProxyEventVerdict({ form: "DEF 14C", ...noAnswer, seeksCombinationApproval: true })
    ).toBe("leave");
  });

  it("still retracts on a false approval verdict when the extraction failed", () => {
    // The approval gate is deterministic AND conjunctive, so a statement that
    // asks for no approval can never emit — with or without a model.
    expect(
      resolveProxyEventVerdict({ form: "DEF 14A", ...noAnswer, seeksCombinationApproval: false })
    ).toBe("retract");
  });
});
