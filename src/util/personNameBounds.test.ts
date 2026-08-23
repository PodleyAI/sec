/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  isOverlongPersonName,
  joinedPersonName,
  MAX_PERSON_NAME_CHARS,
} from "./personNameBounds";

describe("isOverlongPersonName", () => {
  it("keeps a name at the leader-slug cap", () => {
    expect(isOverlongPersonName("a".repeat(MAX_PERSON_NAME_CHARS))).toBe(false);
  });

  it("rejects a name one character over the cap", () => {
    expect(isOverlongPersonName("a".repeat(MAX_PERSON_NAME_CHARS + 1))).toBe(true);
  });

  it("trims before measuring", () => {
    expect(isOverlongPersonName(`  ${"a".repeat(MAX_PERSON_NAME_CHARS)}  `)).toBe(false);
    expect(isOverlongPersonName(`  ${"a".repeat(MAX_PERSON_NAME_CHARS + 1)}  `)).toBe(true);
  });

  it("is safe on null/undefined/empty", () => {
    expect(isOverlongPersonName(null)).toBe(false);
    expect(isOverlongPersonName(undefined)).toBe(false);
    expect(isOverlongPersonName("")).toBe(false);
  });

  it.each([
    "LLC is wholly-owned and controlled by Elizabeth Kern. It received shares for selling various websites and domain names to the Compan Windstream Partners",
    "Assumes the sale of the maximum amount of this Offering (2,500,000 shares of common stock). The aggregate amount of shares to be issued and outst assumption.",
  ])("rejects a footnote stuffed into a person name", (name) => {
    expect(isOverlongPersonName(name)).toBe(true);
  });
});

describe("joinedPersonName", () => {
  it("joins the same way a leader display name is built", () => {
    expect(joinedPersonName("Jane", "Q", "Doe", "Jr.")).toBe("Jane Q Doe Jr.");
  });

  it("rejects a Form D related-person whose parts concatenate past the cap", () => {
    const first = "Metropolitan Area Advisory Committee on Anti-Poverty of San Diego County, Inc.";
    const last = "Metropolitan Area Advisory Committee on Anti-Poverty of San Diego County, Inc.";
    const suffix = "Inc.";
    const joined = joinedPersonName(first, null, last, suffix);
    expect(joined.length).toBeGreaterThan(MAX_PERSON_NAME_CHARS);
    expect(isOverlongPersonName(joined)).toBe(true);
  });
});
