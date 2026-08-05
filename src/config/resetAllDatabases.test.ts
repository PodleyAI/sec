/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetAllDatabases } from "./resetAllDatabases";
import { SEC_STORAGE_REGISTRY } from "./storageRegistry";
import { resetDependencyInjectionsForTesting } from "./TestingDI";

/**
 * Drift guard for `sec db reset --confirm`. The SQL backends drop the tables in
 * the ownership registry, but the in-memory fallback still truncates a
 * hand-maintained list of repository tokens; a table whose `deleteAll()` is
 * forgotten there survives a "reset" fully populated (orphan rows + dangling
 * cross-tier references).
 *
 * The check runs the real reset against in-memory repositories and asserts each
 * registered storage was actually truncated, so it fails on a token the list
 * never reaches — not merely on one whose name is absent from the source text.
 */
describe("resetAllDatabases token coverage", () => {
  it("truncates every storage in the registry", async () => {
    resetDependencyInjectionsForTesting();

    const truncations = SEC_STORAGE_REGISTRY.map((definition) => ({
      id: definition.token.id,
      spy: vi.spyOn(globalServiceRegistry.get(definition.token), "deleteAll"),
    }));

    // No SEC_DB_TYPE is bound after the reset above, so this takes the
    // in-memory fallback — the arm that truncates token by token.
    await resetAllDatabases();

    const missing = truncations
      .filter(({ spy }) => spy.mock.calls.length === 0)
      .map(({ id }) => id)
      .sort();
    expect(missing).toEqual([]);
  });
});
