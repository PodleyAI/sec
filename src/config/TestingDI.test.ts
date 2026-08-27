/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { ADDRESS_REPOSITORY_TOKEN } from "../storage/address/AddressSchema";
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
});
