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
  uniqueIndexes?: readonly (readonly (keyof Entity)[])[]
): ITabularStorage<Schema, PrimaryKeyNames, Entity> {
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
      undefined, // tabularMigrations (default)
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
      undefined, // tabularMigrations (default)
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
