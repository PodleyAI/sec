/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { setupAllDatabases } from "./setupAllDatabases";
import { SEC_STORAGE_REGISTRY } from "./storageRegistry";
import { resetDependencyInjectionsForTesting } from "./TestingDI";

/**
 * The mirror of the reset guard: `db setup` calls `setupDatabase()` on a
 * hand-maintained list of tokens, so a table added to the registry but not to
 * that list is simply never created — every write to it fails at runtime on a
 * freshly set-up database.
 */
describe("setupAllDatabases token coverage", () => {
  it("sets up every storage in the registry", async () => {
    resetDependencyInjectionsForTesting();

    const setups = SEC_STORAGE_REGISTRY.map((definition) => ({
      id: definition.token.id,
      spy: vi.spyOn(globalServiceRegistry.get(definition.token), "setupDatabase"),
    }));

    // In-memory repositories with no SEC_DB_* bound: `setupDatabase()` is a
    // no-op and every raw-SQL branch (migrations, view DDL, the Postgres
    // column alignment, the rate limiter) short-circuits on the backend check.
    await setupAllDatabases();

    const missing = setups
      .filter(({ spy }) => spy.mock.calls.length === 0)
      .map(({ id }) => id)
      .sort();
    expect(missing).toEqual([]);
  });
});
