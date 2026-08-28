/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { createServiceToken, globalServiceRegistry, type ITabularStorage } from "workglow";
import { ADDRESS_REPOSITORY_TOKEN } from "../storage/address/AddressSchema";
import {
  listDatabaseExtensionTokens,
  registerDatabaseExtension,
  registerDatabaseSetupHook,
  runDatabaseSetupHooks,
} from "./databaseExtensions";
import { SEC_STORAGE_REGISTRY } from "./storageRegistry";
import { resetDependencyInjectionsForTesting } from "./TestingDI";
import { ENV_DERIVED_TOKENS } from "./tokens";

describe("resetDependencyInjectionsForTesting", () => {
  it("removes every env-derived token so it does not leak into the next test file", () => {
    // Seed every env-derived token with a dummy value, then reset. Each one
    // must be gone afterwards — otherwise a value registered by a previous
    // test file would silently change behaviour under the shared registry.
    for (const token of ENV_DERIVED_TOKENS) {
      globalServiceRegistry.registerInstance(token, "test-value");
    }

    resetDependencyInjectionsForTesting();

    for (const token of ENV_DERIVED_TOKENS) {
      expect(globalServiceRegistry.has(token), `${token.id} should be unregistered`).toBe(false);
    }
  });

  it("binds an in-memory storage for every table in the registry", () => {
    resetDependencyInjectionsForTesting();

    const unbound = SEC_STORAGE_REGISTRY.filter(
      (definition) => !globalServiceRegistry.has(definition.token)
    ).map((definition) => definition.token.id);
    expect(unbound).toEqual([]);
    expect(globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN).isDurable?.()).toBe(false);
  });

  it("drops database-extension tokens and setup hooks", () => {
    // Both live in module-level arrays, so under a runner that shares one
    // process across test files they outlive the container they were registered
    // against: a later `setupAllDatabases()` would run a hook belonging to a
    // file that has already finished, against a container this reset just
    // rebuilt, and resolve tokens bound to a database nobody reopened.
    let hookCalls = 0;
    registerDatabaseExtension([createServiceToken<ITabularStorage<any, any>>("test.leaked")]);
    registerDatabaseSetupHook(() => {
      hookCalls += 1;
    });

    resetDependencyInjectionsForTesting();

    expect(listDatabaseExtensionTokens()).toEqual([]);
    runDatabaseSetupHooks();
    expect(hookCalls).toBe(0);
  });
});
