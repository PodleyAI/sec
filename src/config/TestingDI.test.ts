/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { ADDRESS_REPOSITORY_TOKEN } from "../storage/address/AddressSchema";
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

  it("re-registers the in-memory repository bindings", () => {
    // Guard against a future refactor that clobbers the repo re-registration —
    // ADDRESS_REPOSITORY_TOKEN stands in for the whole set.
    resetDependencyInjectionsForTesting();
    expect(globalServiceRegistry.has(ADDRESS_REPOSITORY_TOKEN)).toBe(true);
  });
});
