/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { hasSpacFormationIdentification, parseSpacClassification } from "./parseSpacClassification";

const SPAC = [
  "Acme Acquisition Corp. is a newly organized blank check company formed for the purpose of effecting a merger, share exchange, asset acquisition, stock purchase, reorganization or similar business combination with one or more businesses.",
  "We have not selected any specific business combination target.",
].join(" ");

const OPERATING =
  "We develop and sell industrial energy storage systems. We intend to focus on our target markets, which include medical device companies. We may pursue acquisitions as part of our growth strategy.";

describe("parseSpacClassification", () => {
  it("returns null on empty or operating-company prose", () => {
    expect(parseSpacClassification("")).toBeNull();
    expect(parseSpacClassification(OPERATING)).toBeNull();
    expect(hasSpacFormationIdentification(OPERATING)).toBe(false);
  });

  it("hits a stereotyped blank-check formation sentence", () => {
    const row = parseSpacClassification(SPAC);
    expect(row?.is_spac).toBe(true);
    expect(row?.entity_kind).toBe("spac");
    expect(row?.source).toBe("deterministic");
    expect(SPAC.includes(row!.source_span)).toBe(true);
  });
});
