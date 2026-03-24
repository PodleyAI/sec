/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync } from "fs";
import path from "path";
import { globalServiceRegistry, Sqlite } from "workglow";
import { SEC_DB_FOLDER, SEC_DB_NAME } from "../config/tokens";

let db: Sqlite.Database | null = null;

export function getDb(): Sqlite.Database {
  if (!db) {
    const dir = globalServiceRegistry.get(SEC_DB_FOLDER);
    mkdirSync(dir, { recursive: true });
    const location = path.join(dir, `${globalServiceRegistry.get(SEC_DB_NAME)}.sqlite`);
    db = new Sqlite.Database(location);
    db.exec("PRAGMA synchronous = 0");
    db.exec("PRAGMA cache_size = 1000000");
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("PRAGMA temp_store = MEMORY");
    db.exec("PRAGMA journal_mode = OFF");
  }
  return db;
}
