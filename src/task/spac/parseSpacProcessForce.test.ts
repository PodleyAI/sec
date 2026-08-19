/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
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
