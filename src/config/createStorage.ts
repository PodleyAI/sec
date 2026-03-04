/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import type { DataPortSchemaObject, FromSchema, TypedArraySchemaOptions } from "@workglow/util";
import { PostgresTabularStorage, SqliteTabularStorage } from "@workglow/storage";
import { globalServiceRegistry } from "@workglow/util";
import { SEC_DB_TYPE } from "./tokens";
import { getDb } from "../util/db";
import { getPgPool } from "../util/pg";

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
  if (dbType === "postgres") {
    return new PostgresTabularStorage(getPgPool(), table, schema, primaryKeyNames, indexes as any);
  }
  return new SqliteTabularStorage(getDb(), table, schema, primaryKeyNames, indexes as any);
}
