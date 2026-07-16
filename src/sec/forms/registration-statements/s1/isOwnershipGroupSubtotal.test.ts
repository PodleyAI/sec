/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { isOwnershipGroupSubtotal } from "./sectionExtractors";

describe("isOwnershipGroupSubtotal", () => {
  // Verbatim subtotal labels from the committed real S-1 ownership tables. Each
  // was emitted by the model as an `owner_kind: "company"` row before this guard,
  // which the S-1 persist path resolves into the canonical company tier.
  it.each([
    "All executive officers, directors and director nominees as a group (five individuals)",
    "All officers, directors and director nominees as a group (9 individuals)",
    "All directors, director nominees and officers as a group (six persons)",
    "All directors and named executive officers as a group (5 persons)",
    "All directors, director nominees and executive officers as a group (three (3) individuals)",
    "All officers and directors as a group (four persons)",
    "  all our executive officers and directors as a group  ",
  ])("treats %j as a subtotal", (name) => {
    expect(isOwnershipGroupSubtotal(name)).toBe(true);
  });

  // Real owner names from the same tables must never be dropped.
  it.each([
    "26 Capital Holdings LLC",
    "Churchill Sponsor XII LLC",
    "1Sharpe SPAC Sponsor LLC",
    "BGPT 1.12 LP",
    "V-Cube, Inc. and Naoaki Mashita",
    "Jason Ader",
    "Frank R. Martire, Jr.",
    "Richard J Boyle, Jr.",
    // "All-" is a legitimate company-name prefix; only the "as a group" subtotal
    // phrasing marks an aggregate.
    "Allstate Corporation",
    "Alliance Group Holdings LLC",
    "Allied Capital Group, Inc.",
  ])("keeps %j", (name) => {
    expect(isOwnershipGroupSubtotal(name)).toBe(false);
  });

  it("is safe on null/undefined/empty", () => {
    expect(isOwnershipGroupSubtotal(null)).toBe(false);
    expect(isOwnershipGroupSubtotal(undefined)).toBe(false);
    expect(isOwnershipGroupSubtotal("")).toBe(false);
  });
});
