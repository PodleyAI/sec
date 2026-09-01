/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { CrowdfundingHistorySchema } from "./CrowdfundingHistorySchema";
import { CrowdfundingSchema } from "./CrowdfundingSchema";

/**
 * `crowdfunding_history` versions `crowdfunding`, so every column the two share
 * must be at least as wide in the history table. A narrower history column
 * rejects the very write its parent just accepted — and it fails on the SECOND
 * write (the history append), after the parent row has already committed, so
 * the symptom is a filing that half-landed rather than a clean rejection.
 *
 * This is not a hypothetical. When the parent's narratives were widened from
 * 255 to 256 against EDGAR's STRING_256_TYPE, and the DDL widened the columns on
 * BOTH tables, this schema was left at 255 — so the fix was complete in the
 * database and incomplete in the code, which is the combination least likely to
 * be noticed: the ALTER succeeds, the tests pass, and only a 256-character
 * narrative reaching the history writer shows it.
 *
 * Derived from the two schemas rather than a hand-listed set of columns, so a
 * field added to the parent is covered the moment it appears in both.
 */
describe("CrowdfundingHistorySchema mirrors CrowdfundingSchema", () => {
  /** Narrowest declared maxLength across a possibly-nullable union. */
  const widthOf = (prop: unknown): number | undefined => {
    if (prop === null || typeof prop !== "object") return undefined;
    const p = prop as Record<string, unknown>;
    const branches = (Array.isArray(p.anyOf) ? p.anyOf : [p]) as Array<Record<string, unknown>>;
    const widths = branches
      .map((b) => b.maxLength)
      .filter((n): n is number => typeof n === "number");
    return widths.length === 0 ? undefined : Math.min(...widths);
  };

  const parent = CrowdfundingSchema.properties as Record<string, unknown>;
  const history = CrowdfundingHistorySchema.properties as Record<string, unknown>;

  // Only columns BOTH tables declare a width for; the history table carries
  // extra bookkeeping columns (change_source, ...) with no parent counterpart.
  const shared = Object.keys(parent).filter(
    (k) => k in history && widthOf(parent[k]) !== undefined && widthOf(history[k]) !== undefined
  );

  it("shares a meaningful number of bounded columns", () => {
    // Guards the guard: an empty `shared` would make every case below vacuous.
    expect(shared.length).toBeGreaterThanOrEqual(4);
  });

  it.each(shared)("%s is not narrower in history than in the parent", (field) => {
    const p = widthOf(parent[field]) as number;
    const h = widthOf(history[field]) as number;
    expect(
      h,
      `crowdfunding.${field} allows ${p} chars but crowdfunding_history.${field} allows ${h} — ` +
        `a value the parent accepts would fail on the history append`
    ).toBeGreaterThanOrEqual(p);
  });
});
