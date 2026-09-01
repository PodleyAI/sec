/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, InMemoryTabularStorage } from "workglow";
import { clearDatabaseExtensionsForTesting } from "./databaseExtensions";
import { registerStorages, SEC_STORAGE_REGISTRY } from "./storageRegistry";
import { clearRegisteredTablesForTesting } from "./tableRegistry";
import { ENV_DERIVED_TOKENS } from "./tokens";

/**
 * Removes only the env-derived bindings ({@link ENV_DERIVED_TOKENS}) — the
 * `SEC_DB_*` / `SEC_DRY_RUN` state that leaks between tests — without
 * re-registering the registry's in-memory storages. Reach for this in a test
 * that exercises registry-reading logic and needs no repositories at all;
 * {@link resetDependencyInjectionsForTesting} is the full reset.
 *
 * INVARIANT: any new env-derived token added to `EnvToDI.ts` or set by a CLI
 * preAction hook must also be appended to `ENV_DERIVED_TOKENS` in `tokens.ts`
 * — otherwise this reset will not remove it and the container will carry the
 * stale binding forward.
 */
export function clearEnvDerivedTokensForTesting(): void {
  for (const token of ENV_DERIVED_TOKENS) {
    globalServiceRegistry.container.remove(token.id);
  }
}

/**
 * Rewire the DI container for a fresh test file: strip env-projected tokens and
 * the module-level registries keyed to them so no value bound by a prior test
 * file leaks into the current one, then bind every table in
 * {@link SEC_STORAGE_REGISTRY} to an in-memory storage.
 *
 * A downstream package opts back in afterwards — in-memory repositories bound
 * directly, or `registerDatabaseSetupHook` again for a test that wants the
 * persistent wiring against a database it has just pointed sec at.
 */
export function resetDependencyInjectionsForTesting(): void {
  // Strip env-derived tokens first so a value registered by a previous test
  // file does not survive into the current file's repo re-registration.
  clearEnvDerivedTokensForTesting();
  // The table-ownership registry is populated by createStorage, which the
  // in-memory test repos below bypass. Clear it so a table registered by a
  // previous test file's DefaultDI wiring cannot leak into this one.
  clearRegisteredTablesForTesting();
  // Database-extension tokens and setup hooks are module-level state, so they
  // outlive the container they were registered against. Under a runner that
  // shares one process across test files, a hook installed by an earlier file
  // would otherwise run inside every later `setupAllDatabases()` and rebuild its
  // repositories through `createStorage` — which reads the SEC_DB_TYPE binding
  // this reset has just stripped — while its tokens still resolve to storages
  // bound to a database this file never opened.
  clearDatabaseExtensionsForTesting();
  registerStorages(
    SEC_STORAGE_REGISTRY,
    (definition) =>
      new InMemoryTabularStorage(
        definition.schema,
        definition.primaryKeyNames,
        definition.indexes,
        undefined, // clientProvidedKeys (default)
        undefined, // tabularMigrations
        undefined, // migrationName (default)
        definition.uniqueIndexes
      )
  );
}
