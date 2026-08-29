/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import {
  clearFormExtractorsForTesting,
  registerFormExtractor,
} from "../../sec/forms/formExtractors";
import {
  clearRegisteredBackfillDescriptorsForTesting,
  registerBackfillDescriptor,
} from "../forms/backfillDescriptors";
import { parseSpacProcessForce } from "./parseSpacProcessForce";

describe("parseSpacProcessForce", () => {
  it("treats omitted and false as none", () => {
    expect(parseSpacProcessForce(undefined)).toEqual({ kind: "none" });
    expect(parseSpacProcessForce(false)).toEqual({ kind: "none" });
  });

  it("treats bare true, empty string, and 'all' as all", () => {
    expect(parseSpacProcessForce(true)).toEqual({ kind: "all" });
    expect(parseSpacProcessForce("")).toEqual({ kind: "all" });
    expect(parseSpacProcessForce("all")).toEqual({ kind: "all" });
  });

  it("parses a comma-separated extractor list, trimming whitespace", () => {
    expect(parseSpacProcessForce("S-1, redemption")).toEqual({
      kind: "extractors",
      ids: ["S-1", "redemption"],
    });
  });

  it("throws naming the unknown id and the valid list", () => {
    expect(() => parseSpacProcessForce("nope")).toThrow(/nope/);
    expect(() => parseSpacProcessForce("nope")).toThrow(/S-1/);
  });
});

/**
 * `spac process --force` and `extractor backfill` take the same kind of
 * argument, so they must agree on what an extractor id is. Both sources an id
 * can arrive by that a list compiled into this package cannot name are checked
 * here.
 */
describe("parseSpacProcessForce validates against the live extractor vocabulary", () => {
  /** A reading that runs inside another extractor's `store` and registers no form. */
  const CONTRIBUTED_ID = "8-k-narrative";
  /** A reading a consumer registers against a form of this package's. */
  const REGISTERED_ID = "rega-financials-1k";

  const noopStore = async (): Promise<void> => {};

  afterEach(() => clearRegisteredBackfillDescriptorsForTesting());

  afterAll(() => {
    // Leave the registry as it was found: clearing re-arms `registerSecFormExtractors`.
    clearFormExtractorsForTesting();
    registerSecFormExtractors();
  });

  it("accepts an id reachable only through a contributed descriptor", () => {
    // Nothing in the form-extractor registry names such a reading — it has no
    // form of its own — so the contributed descriptor is the only evidence
    // this deployment can run it, and refusing the id before one is registered
    // is what shows the descriptor is doing the work.
    expect(() => parseSpacProcessForce(CONTRIBUTED_ID)).toThrow(
      new RegExp(`Unknown extractor '${CONTRIBUTED_ID}'`)
    );
    registerBackfillDescriptor({ extractorId: CONTRIBUTED_ID, selectCandidates: async () => [] });
    expect(parseSpacProcessForce(CONTRIBUTED_ID)).toEqual({
      kind: "extractors",
      ids: [CONTRIBUTED_ID],
    });
  });

  it("accepts an extractor a consumer registers in the open registry", () => {
    registerFormExtractor({ id: REGISTERED_ID, forms: ["1-K"], store: noopStore });
    expect(parseSpacProcessForce(REGISTERED_ID)).toEqual({
      kind: "extractors",
      ids: [REGISTERED_ID],
    });
  });

  it("still rejects a typo, offering the vocabulary in force rather than a compiled one", () => {
    registerBackfillDescriptor({ extractorId: CONTRIBUTED_ID, selectCandidates: async () => [] });
    expect(() => parseSpacProcessForce("redemtion")).toThrow(/Unknown extractor 'redemtion'/);
    expect(() => parseSpacProcessForce("redemtion")).toThrow(new RegExp(CONTRIBUTED_ID));
  });
});
