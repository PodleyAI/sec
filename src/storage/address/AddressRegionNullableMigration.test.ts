/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DB_TYPE, SEC_DRY_RUN } from "../../config/tokens";
import { migrateAddressRegionNullable } from "./AddressRegionNullableMigration";

describe("migrateAddressRegionNullable", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });
  afterEach(() => {
    // Clear tokens; resetDependencyInjectionsForTesting only re-registers
    // repos, so token bindings leak across test files otherwise.
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, false);
    resetDependencyInjectionsForTesting();
  });

  it("is a no-op on the SQLite backend", async () => {
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    await expect(migrateAddressRegionNullable()).resolves.toBeUndefined();
  });

  it("is a no-op on an unknown / in-memory backend (no SEC_DB_TYPE bound)", async () => {
    // No SEC_DB_TYPE registered → dbType branch resolves to null → returns
    // without touching pg. If it tried, no pg pool is configured and it would
    // throw.
    await expect(migrateAddressRegionNullable()).resolves.toBeUndefined();
  });

  it("bails under --dry-run before touching the database", async () => {
    // Register postgres AND dry-run — the dry-run bail must fire first, so
    // this must not attempt to open a pg connection.
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    await expect(migrateAddressRegionNullable()).resolves.toBeUndefined();
  });
});
