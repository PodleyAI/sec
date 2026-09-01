/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearResolverExtensionsForTesting } from "../../resolver/resolverExtensions";
import { isRegisteredComponent, listRegisteredComponents } from "./componentRegistry";

describe("componentRegistry", () => {
  beforeEach(() => {
    clearResolverExtensionsForTesting();
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

  it("registers no resolver of its own", () => {
    expect(isRegisteredComponent("resolver", "person")).toBe(false);
  });

  it("rejects unknown ids", () => {
    expect(isRegisteredComponent("extractor", "X")).toBe(false);
    expect(isRegisteredComponent("resolver", "sponsor")).toBe(false);
  });

  it("listRegisteredComponents returns one entry per extractor and resolver", () => {
    // 26 extractors (D, C, CFPORTAL, 1-A, 1-A-W, 1-K, 1-Z, 1-U, 253G,
    // QUALIF, rega-financials-1sa, 3, 4, 5, 144, S-1, S-1-xbrl, 424, 424-xbrl,
    // 8-K, 8-K-items, merger-proxy, redemption, loi, 25-15, RW) and no
    // resolver: every resolver kind now comes from a package that contributes
    // one.
    expect(listRegisteredComponents()).toHaveLength(26);
  });
});
