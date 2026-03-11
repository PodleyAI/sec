/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import type { DataPortSchemaObject, FromSchema, TypedArraySchemaOptions } from "@workglow/util";
import { PostgresTabularStorage, SqliteTabularStorage } from "@workglow/storage";
import { globalServiceRegistry } from "@workglow/util";
import { SEC_DB_TYPE, SEC_DRY_RUN } from "./tokens";
import { getDb } from "../util/db";
import { getPgPool } from "../util/pg";
import { ReadOnlyTabularStorage } from "../storage/ReadOnlyTabularStorage";

export function createStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>(
  table: string,
  schema: Schema,
  primaryKeyNames: PrimaryKeyNames,
  indexes?: readonly (keyof Entity | readonly (keyof Entity)[])[]
): ITabularStorage<Schema, PrimaryKeyNames, Entity> {
  const dbType = globalServiceRegistry.get(SEC_DB_TYPE);
  let storage: ITabularStorage<Schema, PrimaryKeyNames, Entity>;
  if (dbType === "postgres") {
    storage = new PostgresTabularStorage(getPgPool(), table, schema, primaryKeyNames, indexes as any);
  } else {
    storage = new SqliteTabularStorage(getDb(), table, schema, primaryKeyNames, indexes as any);
  }

  if (globalServiceRegistry.has(SEC_DRY_RUN) && globalServiceRegistry.get(SEC_DRY_RUN)) {
    return new ReadOnlyTabularStorage(storage) as unknown as ITabularStorage<
      Schema,
      PrimaryKeyNames,
      Entity
    >;
  }
  return storage;
}
