/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite } from "@workglow/sqlite";
import { globalServiceRegistry } from "@workglow/util";
import { mkdirSync } from "fs";
import path from "path";
import { SEC_DB_FOLDER, SEC_DB_NAME } from "../config/tokens";

let db: Sqlite.Database | null = null;

export function getDb(): Sqlite.Database {
  if (!db) {
    const dir = globalServiceRegistry.get(SEC_DB_FOLDER);
    mkdirSync(dir, { recursive: true });
    const location = path.join(dir, `${globalServiceRegistry.get(SEC_DB_NAME)}.sqlite`);
    db = new Sqlite.Database(location, {
      readwrite: true,
      create: true,
    });
    db.run("PRAGMA synchronous = 0");
    db.run("PRAGMA cache_size = 1000000");
    db.run("PRAGMA locking_mode = EXCLUSIVE");
    db.run("PRAGMA temp_store = MEMORY");
    db.run("PRAGMA journal_mode = OFF");
  }
  return db;
}
