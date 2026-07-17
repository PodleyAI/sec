/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolverIds, isFamilyResolverId } from "./resolverIds";
import { clearResolverExtensionsForTesting } from "./resolverExtensions";
import { registerSecResolvers } from "../config/registerResolvers";

describe("resolverIds", () => {
  beforeEach(() => {
    clearResolverExtensionsForTesting();
    registerSecResolvers();
  });
  afterEach(() => {
    clearResolverExtensionsForTesting();
  });

  it("contains the registered resolver ids", () => {
    const ids = resolverIds();
    for (const id of ["person", "company", "sponsor-family", "underwriter-family"]) {
      expect(ids).toContain(id);
    }
  });

  it("classifies family-tier resolver kinds", () => {
    expect(isFamilyResolverId("sponsor-family")).toBe(true);
    expect(isFamilyResolverId("underwriter-family")).toBe(true);
    expect(isFamilyResolverId("person")).toBe(false);
    expect(isFamilyResolverId("company")).toBe(false);
    expect(isFamilyResolverId("nope")).toBe(false);
  });
});
