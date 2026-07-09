/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { isStaleByAsOf } from "./asOfGuard";

describe("isStaleByAsOf", () => {
  it("is not stale when there is no existing marker", () => {
    expect(isStaleByAsOf(undefined, "2024-01-01")).toBe(false);
    expect(isStaleByAsOf(null, "2024-01-01")).toBe(false);
    expect(isStaleByAsOf("", "2024-01-01")).toBe(false);
  });

  it("is stale when the incoming filing is older than the marker", () => {
    expect(isStaleByAsOf("2024-06-01", "2024-01-01")).toBe(true);
  });

  it("is not stale when the incoming filing is newer or equal", () => {
    expect(isStaleByAsOf("2024-01-01", "2024-06-01")).toBe(false);
    expect(isStaleByAsOf("2024-01-01", "2024-01-01")).toBe(false);
  });

  it("treats an undated incoming filing as stale against a dated row", () => {
    // It cannot be ordered, so it must not clobber a known-dated row.
    expect(isStaleByAsOf("2024-01-01", "")).toBe(true);
  });

  it("applies an undated incoming filing when the existing row is also undated", () => {
    expect(isStaleByAsOf("", "")).toBe(false);
  });
});
