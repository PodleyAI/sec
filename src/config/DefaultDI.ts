/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStorage } from "./createStorage";
import { registerStorages, SEC_STORAGE_REGISTRY } from "./storageRegistry";

/**
 * Production wiring: every table in {@link SEC_STORAGE_REGISTRY} bound to a
 * backend-appropriate storage (SQLite or Postgres, per `SEC_DB_TYPE`).
 */
export const DefaultDI = (): void => {
  registerStorages(SEC_STORAGE_REGISTRY, (definition) =>
    createStorage(
      definition.table,
      definition.schema,
      definition.primaryKeyNames,
      definition.indexes,
      definition.uniqueIndexes
    )
  );
};
