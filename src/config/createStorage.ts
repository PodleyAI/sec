/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DataPortSchemaObject,
  FromSchema,
  ITabularStorage,
  TypedArraySchemaOptions,
} from "workglow";
import { globalServiceRegistry, PostgresTabularStorage, SqliteTabularStorage } from "workglow";
import { isDryRun } from "../cli/isDryRun";
import { ReadOnlyTabularStorage } from "../storage/ReadOnlyTabularStorage";
import { getDb } from "../util/db";
import { getPgPool } from "../util/pg";
import { registerTable } from "./tableRegistry";
import { SEC_DB_TYPE } from "./tokens";

/**
 * Builds the backend-appropriate tabular storage for one table and records it
 * in the {@link registerTable} ownership registry.
 *
 * No `tabularMigrations` argument: the storage layer's op set is add/drop/rename
 * column, add/drop index and backfill, with no `alterColumn`, so it cannot
 * express either shape sec actually needs — widening a `varchar(n)` or relaxing
 * a `NOT NULL`. Emulating them as add + backfill + drop + rename is a full table
 * rewrite and is impossible outright for a primary-key column. Both are handled
 * instead by `alignPostgresColumnTypes()` (Postgres) and the per-table rebuild
 * migrations (SQLite). Thread the argument through if a supported op is ever
 * declared; until then it would only pass `undefined` from a different place.
 */
export function createStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>(
  table: string,
  schema: Schema,
  primaryKeyNames: PrimaryKeyNames,
  indexes?: readonly (keyof Entity | readonly (keyof Entity)[])[],
  uniqueIndexes?: readonly (readonly (keyof Entity)[])[]
): ITabularStorage<Schema, PrimaryKeyNames, Entity> {
  registerTable({
    table,
    schema,
    primaryKeyNames: primaryKeyNames as ReadonlyArray<string>,
  });
  const dbType = globalServiceRegistry.get(SEC_DB_TYPE);
  let storage: ITabularStorage<Schema, PrimaryKeyNames, Entity>;
  if (dbType === "postgres") {
    storage = new PostgresTabularStorage(
      getPgPool(),
      table,
      schema,
      primaryKeyNames,
      indexes,
      undefined, // clientProvidedKeys (default)
      undefined, // tabularMigrations — see the note above
      uniqueIndexes
    );
  } else {
    storage = new SqliteTabularStorage(
      getDb(),
      table,
      schema,
      primaryKeyNames,
      indexes,
      undefined, // clientProvidedKeys (default)
      undefined, // tabularMigrations — see the note above
      uniqueIndexes
    );
  }

  if (isDryRun()) {
    return new ReadOnlyTabularStorage(storage) as unknown as ITabularStorage<
      Schema,
      PrimaryKeyNames,
      Entity
    >;
  }
  return storage;
}
