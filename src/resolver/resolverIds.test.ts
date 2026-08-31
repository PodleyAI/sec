/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolverIds, isFamilyResolverId } from "./resolverIds";
import { clearResolverExtensionsForTesting } from "./resolverExtensions";

describe("resolverIds", () => {
  beforeEach(() => {
    clearResolverExtensionsForTesting();
  });
  afterEach(() => {
    clearResolverExtensionsForTesting();
  });

  it("contains the registered resolver ids", () => {
    // Empty here, and that is the assertion: this package registers no resolver
    // kind of its own. Every id comes from a package that contributes one, and
    // asserts its own registration there.
    expect(resolverIds()).toEqual([]);
  });

  it("classifies family-tier resolver kinds", () => {
    // A kind is a family only because its registration said so, and this
    // package registers no family kinds — the tier that does is a downstream
    // package's, and asserts the true case there.
    expect(isFamilyResolverId("sponsor-family")).toBe(false);
    expect(isFamilyResolverId("person")).toBe(false);
    expect(isFamilyResolverId("company")).toBe(false);
    expect(isFamilyResolverId("nope")).toBe(false);
  });
});
