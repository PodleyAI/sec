/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, Sqlite } from "workglow";
import { isDryRun } from "../cli/isDryRun";
import { setupSecFetchRateLimiter } from "../task/fetch/SecJobQueue";
import { getDb } from "../util/db";
import {
  addMissingColumnsPostgres,
  addMissingColumnsSqlite,
  shouldAddMissingColumns,
} from "./addMissingColumns";
import { alignPostgresColumnTypes } from "./alignPostgresColumnTypes";
import { dropStaleCheckConstraints } from "./dropStaleCheckConstraints";
import { SEC_STORAGE_REGISTRY } from "./storageRegistry";
import { SEC_DB_FOLDER, SEC_DB_TYPE } from "./tokens";

/**
 * Creates every table and index this package owns, from the TypeBox schemas in
 * {@link SEC_STORAGE_REGISTRY}.
 *
 * Adding a table is one `defineStorage` entry there and nothing here: this
 * walks the registry in declaration order, which is also the order
 * `resetAllDatabases` drops in.
 */
export async function setupAllDatabases(): Promise<void> {
  // Load the SQLite native binding before any repo opens a database. Guarded
  // because older workglow releases ship without Sqlite.init.
  if (typeof Sqlite.init === "function") {
    await Sqlite.init();
  }

  for (const definition of SEC_STORAGE_REGISTRY) {
    await globalServiceRegistry.get(definition.token).setupDatabase();
  }

  // Add any column an existing database is missing outright, widen / relax any
  // it still has at a narrower or stricter shape than the schema declares, then
  // drop any CHECK bound the schema has since removed.
  //
  // Order matters: a column added by the first pass is then eligible for the
  // second in the same `db setup`, rather than waiting for the next one.
  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : "sqlite";

  // Skipped under --dry-run: these passes issue DDL through raw SQL, which the
  // repositories' ReadOnlyTabularStorage wrapper cannot intercept.
  if (
    dbType === "sqlite" &&
    globalServiceRegistry.has(SEC_DB_FOLDER) &&
    shouldAddMissingColumns("sqlite")
  ) {
    addMissingColumnsSqlite(getDb());
  }
  if (dbType === "postgres" && !isDryRun()) {
    if (shouldAddMissingColumns("postgres")) await addMissingColumnsPostgres();
    await alignPostgresColumnTypes();
    await dropStaleCheckConstraints();
    // Create the shared SEC-fetch rate-limiter tables once here, so a
    // multi-shard sweep can enforce EDGAR's budget across processes without
    // each process racing to create the DDL.
    await setupSecFetchRateLimiter();
  }
}
