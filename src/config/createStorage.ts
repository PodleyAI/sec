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
import { SEC_DB_TYPE } from "./tokens";

export function createStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>(
  table: string,
  schema: Schema,
  primaryKeyNames: PrimaryKeyNames,
  indexes?: readonly (keyof Entity | readonly (keyof Entity)[])[],
  // TODO(libs-upgrade): upstream `@workglow/storage` is gaining a
  // `uniqueIndexes` parameter on BaseTabularStorage and emitting
  // `CREATE UNIQUE INDEX IF NOT EXISTS` in the SQLite / Postgres DDL.
  // Until that lands, the extra columns we forward here are silently
  // dropped by the constructors (they only declare positional params up to
  // `tabularMigrations`) and uniqueness is NOT enforced at the storage
  // level. Resolver concurrency is still serialised per-process by
  // AsyncMutex; multi-process safety arrives with the upstream change.
  uniqueIndexes?: readonly (readonly (keyof Entity)[])[]
): ITabularStorage<Schema, PrimaryKeyNames, Entity> {
  const dbType = globalServiceRegistry.get(SEC_DB_TYPE);
  let storage: ITabularStorage<Schema, PrimaryKeyNames, Entity>;
  if (dbType === "postgres") {
    storage = new (PostgresTabularStorage as any)(
      getPgPool(),
      table,
      schema,
      primaryKeyNames,
      indexes as any,
      undefined, // clientProvidedKeys (default)
      undefined, // tabularMigrations (default)
      uniqueIndexes as any
    );
  } else {
    storage = new (SqliteTabularStorage as any)(
      getDb(),
      table,
      schema,
      primaryKeyNames,
      indexes as any,
      undefined, // clientProvidedKeys (default)
      undefined, // tabularMigrations (default)
      uniqueIndexes as any
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
