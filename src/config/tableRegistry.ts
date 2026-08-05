/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "workglow";

/**
 * One persistent table together with the schema its DDL was generated from.
 */
export interface RegisteredTable {
  readonly table: string;
  readonly schema: DataPortSchemaObject;
  readonly primaryKeyNames: ReadonlyArray<string>;
}

const registeredTables = new Map<string, RegisteredTable>();

/**
 * Records a table and its declared schema. Called by {@link createStorage},
 * which every persistent table in this package — and in downstream supersets,
 * whose repo families are built through the same factory — goes through. That
 * makes the registry an exact ownership list derived from the code that
 * actually creates the tables, rather than a second hand-maintained list that
 * can silently fall out of date.
 *
 * Re-registering the same table name replaces the entry: DI is re-initialized
 * per test file and per process, and the schema is identical each time.
 */
export function registerTable(entry: RegisteredTable): void {
  registeredTables.set(entry.table, entry);
}

/** Every table registered so far, in first-registration order. */
export function listRegisteredTables(): ReadonlyArray<RegisteredTable> {
  return [...registeredTables.values()];
}

/** Clears the registry. Test-only — a process never un-owns a table at runtime. */
export function clearRegisteredTablesForTesting(): void {
  registeredTables.clear();
}
