/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, vi } from "vitest";
import type { ServiceToken } from "workglow";
import { globalServiceRegistry, Sqlite } from "workglow";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../tokens";
import { closeDb } from "../../util/db";
import { DefaultDI } from "../DefaultDI";
import { setupAllDatabases } from "../setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../TestingDI";

/** The one member this helper needs off a repository token's storage. */
interface SetupDatabaseCapable {
  setupDatabase(): Promise<void>;
}

export interface SqliteTestDb {
  /** Temp directory holding the database. Only valid inside a test body. */
  readonly dir: string;
}

/**
 * Stands up a real SQLite database in a temp directory for one `describe`,
 * wiring the `beforeEach`/`afterEach` pair itself. Reach for it in a
 * `*.sqlite.test.ts` that exercises a raw-SQL fast path — the paths that
 * `resolveSqlBackend` routes to `getDb()` cannot be tested against an in-memory
 * repository, because they bypass `ITabularStorage` entirely.
 *
 * `setupTokens` limits table creation to the repositories the test actually
 * touches. Omit it to create the full production schema via
 * {@link setupAllDatabases} — correct but ~100 `setupDatabase()` calls per
 * test, so prefer naming the tokens when a test needs one or two tables.
 */
export function withSqliteDb(
  name: string,
  setupTokens?: readonly ServiceToken<SetupDatabaseCapable>[]
): SqliteTestDb {
  let tmpDir = "";

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    closeDb();
    if (typeof Sqlite.init === "function") {
      await Sqlite.init();
    }
    tmpDir = mkdtempSync(join(tmpdir(), `sec-${name}-`));
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    globalServiceRegistry.registerInstance(SEC_DB_FOLDER, tmpDir);
    globalServiceRegistry.registerInstance(SEC_DB_NAME, name);
    DefaultDI();
    if (setupTokens === undefined) {
      await setupAllDatabases();
    } else {
      for (const token of setupTokens) {
        await globalServiceRegistry.get(token).setupDatabase();
      }
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
    resetDependencyInjectionsForTesting();
  });

  return {
    get dir(): string {
      return tmpDir;
    },
  };
}
