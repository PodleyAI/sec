/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DataPortSchemaObject,
  FromSchema,
  ITabularMigration,
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
 * `tabularMigrations` carries declarative schema-evolution steps down to the
 * storage layer. Note what it *cannot* express: the op set is
 * add/drop/rename column, add/drop index and backfill — there is no
 * `alterColumn`, so widening a `varchar(n)` or relaxing a `NOT NULL` is out of
 * reach. Emulating either as add + backfill + drop + rename is a full table
 * rewrite, and is outright impossible for a primary-key column. Those two
 * shapes are handled instead by `alignPostgresColumnTypes()` (Postgres) and
 * the per-table rebuild migrations (SQLite).
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
  uniqueIndexes?: readonly (readonly (keyof Entity)[])[],
  tabularMigrations?: ReadonlyArray<ITabularMigration>
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
      tabularMigrations,
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
      tabularMigrations,
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
