/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, expect, test } from "vitest";
import { registerSecResolvers } from "./registerResolvers";
import {
  listResolverIds,
  isFamilyResolverId,
  getResolverExtension,
  clearResolverExtensionsForTesting,
} from "../resolver/resolverExtensions";

afterEach(() => clearResolverExtensionsForTesting());

test("registers the built-in sec resolver kinds", () => {
  registerSecResolvers();
  const ids = listResolverIds();
  for (const id of ["person", "company", "sponsor-family", "underwriter-family"]) {
    expect(ids).toContain(id);
  }
});

test("families are family-tier, expose coverage, and register no purge", () => {
  registerSecResolvers();
  for (const id of ["sponsor-family", "underwriter-family"]) {
    expect(isFamilyResolverId(id)).toBe(true);
    expect(typeof getResolverExtension(id)?.coverage).toBe("function");
    // Deliberately absent: a family purge has no rebuild path, since the link
    // row is the attribution itself and `sec resolve` refuses family kinds.
    expect(getResolverExtension(id)?.dropPrevious).toBeUndefined();
  }
});

test("person/company expose coverage + dropPrevious", () => {
  registerSecResolvers();
  for (const id of ["person", "company"]) {
    expect(isFamilyResolverId(id)).toBe(false);
    expect(typeof getResolverExtension(id)?.coverage).toBe("function");
    expect(typeof getResolverExtension(id)?.dropPrevious).toBe("function");
  }
});
