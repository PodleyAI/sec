/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSecResolvers } from "../../config/registerResolvers";
import { clearResolverExtensionsForTesting } from "../../resolver/resolverExtensions";
import { isRegisteredComponent, listRegisteredComponents } from "./componentRegistry";

describe("componentRegistry", () => {
  beforeEach(() => {
    clearResolverExtensionsForTesting();
    registerSecResolvers();
  });
  afterEach(() => {
    clearResolverExtensionsForTesting();
  });

  it("registers all extractors", () => {
    for (const id of [
      "D",
      "C",
      "CFPORTAL",
      "1-A",
      "1-K",
      "1-Z",
      "3",
      "4",
      "5",
      "144",
      "S-1",
      "424",
      "8-K",
    ]) {
      expect(isRegisteredComponent("extractor", id)).toBe(true);
    }
  });

  it("registers the person and company resolvers", () => {
    expect(isRegisteredComponent("resolver", "person")).toBe(true);
    expect(isRegisteredComponent("resolver", "company")).toBe(true);
  });

  it("rejects unknown ids", () => {
    expect(isRegisteredComponent("extractor", "X")).toBe(false);
    expect(isRegisteredComponent("resolver", "sponsor")).toBe(false);
  });

  it("listRegisteredComponents returns one entry per extractor and resolver", () => {
    // 25 extractors (D, C, CFPORTAL, 1-A, 1-A-W, 1-K, 1-Z, 1-U, 253G,
    // QUALIF, 3, 4, 5, 144, S-1, S-1-xbrl, 424, 424-xbrl, 8-K, 8-K-items,
    // merger-proxy, redemption, loi, 25-15, RW) + 2 resolvers (person,
    // company). The family kinds a downstream package registers are not here.
    expect(listRegisteredComponents()).toHaveLength(27);
  });
});
