/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, InMemoryTabularStorage } from "workglow";
import { clearEnvDerivedTokensForTesting } from "../config/TestingDI";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE, SEC_DRY_RUN } from "../config/tokens";
import { CikNamePrimaryKeyNames, CikNameSchema } from "../storage/entity/CikNameSchema";
import { resolveSqlBackend } from "./sqlBackend";

/** Stand-in for a repository; only `isDurable` is read. */
const durable = { isDurable: (): boolean => true };
const inMemory = { isDurable: (): boolean => false };

function registerSqliteConfig(): void {
  globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
  globalServiceRegistry.registerInstance(SEC_DB_FOLDER, "/tmp/does-not-need-to-exist");
  globalServiceRegistry.registerInstance(SEC_DB_NAME, "edgar");
}

describe("resolveSqlBackend", () => {
  // Only the env-derived bindings matter here — `resolveSqlBackend` reads the
  // registry and the repo it is handed, never a repository token, so the full
  // reset's ~100 in-memory repositories would be pure overhead.
  beforeEach(() => {
    clearEnvDerivedTokensForTesting();
  });

  // The suite registers SEC_DB_* / SEC_DRY_RUN; leaving them bound would hand
  // the rest of the process exactly the stale-token state this dispatch guards
  // against.
  afterEach(() => {
    clearEnvDerivedTokensForTesting();
  });

  it("falls back to the repository when no backend is configured", () => {
    expect(resolveSqlBackend("write", undefined)).toBe("repository");
    expect(resolveSqlBackend("read", undefined)).toBe("repository");
  });

  it("selects sqlite only when the full config getDb() dereferences is present", () => {
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    // SEC_DB_FOLDER / SEC_DB_NAME absent — getDb() would throw on them.
    expect(resolveSqlBackend("write", undefined)).toBe("repository");
    registerSqliteConfig();
    expect(resolveSqlBackend("write", undefined)).toBe("sqlite");
  });

  it("selects postgres on the type token alone", () => {
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
    expect(resolveSqlBackend("write", undefined)).toBe("postgres");
  });

  it("forces the repository path for a non-durable repo", () => {
    registerSqliteConfig();
    expect(resolveSqlBackend("write", durable)).toBe("sqlite");
    // An in-memory repo is invisible to getDb(); the fast path would read and
    // write a completely different store.
    expect(resolveSqlBackend("write", inMemory)).toBe("repository");
    expect(resolveSqlBackend("read", inMemory)).toBe("repository");
  });

  it("reads the real InMemoryTabularStorage as non-durable", () => {
    // `isDurable` is OPTIONAL on ITabularStorage — the durability guard only
    // works because the in-memory backend actually implements it. Pin that
    // against the stubs above, which would keep passing if it disappeared.
    registerSqliteConfig();
    const storage = new InMemoryTabularStorage(CikNameSchema, CikNamePrimaryKeyNames, []);
    expect(resolveSqlBackend("write", storage)).toBe("repository");
    expect(resolveSqlBackend("read", storage)).toBe("repository");
  });

  it("forces the repository path for a WRITE under --dry-run, even for a durable repo", () => {
    registerSqliteConfig();
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    // Dry run is enforced by wrapping storages in ReadOnlyTabularStorage, which
    // a raw-SQL path bypasses entirely — it would commit for real. The wrapper
    // forwards no isDurable(), so only this guard can catch it.
    expect(resolveSqlBackend("write", undefined)).toBe("repository");
    expect(resolveSqlBackend("write", durable)).toBe("repository");
  });

  it("keeps the raw-SQL fast path for a READ under --dry-run", () => {
    registerSqliteConfig();
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    // A read commits nothing, so dry run has no reason to demote it — and
    // demoting it silently costs a full table scan (listFilingDates) or an N+1
    // (the observation-title IN-list).
    expect(resolveSqlBackend("read", undefined)).toBe("sqlite");
    expect(resolveSqlBackend("read", durable)).toBe("sqlite");
  });

  it("selects a raw-SQL backend again once dry-run is off", () => {
    registerSqliteConfig();
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, false);
    expect(resolveSqlBackend("write", durable)).toBe("sqlite");
  });
});
