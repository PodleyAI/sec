/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync } from "fs";
import path from "path";
import { globalServiceRegistry, Sqlite } from "workglow";
import { SecSqliteCacheMb } from "../config/Constants";
import { SecCliConfigurationError } from "../config/EnvToDI";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../config/tokens";

let db: Sqlite.Database | null = null;

export function getDb(): Sqlite.Database {
  if (!db) {
    // Guard against silent data divergence: if SEC_DB_TYPE is postgres, the
    // rest of the system writes to PG via createStorage(), but a stray
    // getDb() call here would open a separate SQLite file that nothing else
    // reads. Fail loudly so callers route through the abstraction or
    // getPgPool() instead.
    if (globalServiceRegistry.has(SEC_DB_TYPE)) {
      const dbType = globalServiceRegistry.get(SEC_DB_TYPE);
      if (dbType !== "sqlite") {
        throw new SecCliConfigurationError(
          `getDb() is only available when SEC_DB_TYPE=sqlite (current: ${dbType}). ` +
            `Use createStorage() / the repository tokens, or getPgPool() for raw SQL.`
        );
      }
    }
    const dir = globalServiceRegistry.get(SEC_DB_FOLDER);
    mkdirSync(dir, { recursive: true });
    const location = path.join(dir, `${globalServiceRegistry.get(SEC_DB_NAME)}.sqlite`);
    db = new Sqlite.Database(location);
    // WAL + synchronous=NORMAL keeps durability across crashes while still
    // allowing concurrent readers; the previous OFF/0 combination meant any
    // crash mid-write could leave the database irrecoverable.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    // NEGATIVE, so the argument is read as KiB rather than as a page count.
    // See {@link SecSqliteCacheMb}: the positive form names pages, and the
    // million-page value this replaced was a ~4 GB ceiling on a cache that
    // grows with everything the process touches and never shrinks.
    db.exec(`PRAGMA cache_size = -${SecSqliteCacheMb * 1024}`);
    db.exec("PRAGMA temp_store = MEMORY");
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
