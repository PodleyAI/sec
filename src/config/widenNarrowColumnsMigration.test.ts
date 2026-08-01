/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "./TestingDI";
import { SEC_DB_TYPE, SEC_DRY_RUN } from "./tokens";
import { shouldWidenColumn, widenNarrowColumns } from "./widenNarrowColumnsMigration";

describe("shouldWidenColumn", () => {
  it("skips an absent column (undefined length)", () => {
    expect(shouldWidenColumn(undefined, 64)).toBe(false);
  });

  it("skips an unbounded text column (null length)", () => {
    expect(shouldWidenColumn(null, 64)).toBe(false);
  });

  it("widens a narrower column", () => {
    expect(shouldWidenColumn(20, 64)).toBe(true);
  });

  it("skips a column already at target width", () => {
    expect(shouldWidenColumn(64, 64)).toBe(false);
  });

  it("skips a column wider than target", () => {
    expect(shouldWidenColumn(128, 64)).toBe(false);
  });
});

describe("widenNarrowColumns", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });
  afterEach(() => {
    // Clear tokens the individual cases set; resetDependencyInjectionsForTesting
    // only re-registers repos, so a `SEC_DRY_RUN = true` or `SEC_DB_TYPE =
    // "postgres"` binding would leak into later tests otherwise.
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, false);
    resetDependencyInjectionsForTesting();
  });

  it("is a no-op on the in-memory / unset backend (no SEC_DB_TYPE bound)", async () => {
    // No SEC_DB_TYPE registered → dbType branch resolves to null → returns
    // without touching pg. If it tried, no pg pool is configured and it would
    // throw.
    await expect(widenNarrowColumns()).resolves.toBeUndefined();
  });

  it("is a no-op on the SQLite backend", async () => {
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    await expect(widenNarrowColumns()).resolves.toBeUndefined();
  });

  it("bails under --dry-run before touching the database", async () => {
    // Register postgres AND dry-run — the dry-run bail must fire first, so
    // this must not attempt to open a pg connection.
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    await expect(widenNarrowColumns()).resolves.toBeUndefined();
  });
});
