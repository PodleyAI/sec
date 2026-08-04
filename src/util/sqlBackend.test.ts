/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE, SEC_DRY_RUN } from "../config/tokens";
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
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("falls back to the repository when no backend is configured", () => {
    expect(resolveSqlBackend()).toBe("repository");
  });

  it("selects sqlite only when the full config getDb() dereferences is present", () => {
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    // SEC_DB_FOLDER / SEC_DB_NAME absent — getDb() would throw on them.
    expect(resolveSqlBackend()).toBe("repository");
    registerSqliteConfig();
    expect(resolveSqlBackend()).toBe("sqlite");
  });

  it("selects postgres on the type token alone", () => {
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
    expect(resolveSqlBackend()).toBe("postgres");
  });

  it("forces the repository path for a non-durable repo", () => {
    registerSqliteConfig();
    expect(resolveSqlBackend(durable)).toBe("sqlite");
    // An in-memory repo is invisible to getDb(); the fast path would read and
    // write a completely different store.
    expect(resolveSqlBackend(inMemory)).toBe("repository");
  });

  it("forces the repository path under --dry-run, even for a durable repo", () => {
    registerSqliteConfig();
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    // Dry run is enforced by wrapping storages in ReadOnlyTabularStorage, which
    // a raw-SQL path bypasses entirely — it would commit for real. The wrapper
    // forwards no isDurable(), so only this guard can catch it.
    expect(resolveSqlBackend()).toBe("repository");
    expect(resolveSqlBackend(durable)).toBe("repository");
  });

  it("selects a raw-SQL backend again once dry-run is off", () => {
    registerSqliteConfig();
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, false);
    expect(resolveSqlBackend(durable)).toBe("sqlite");
  });
});
