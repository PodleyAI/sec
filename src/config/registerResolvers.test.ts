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
import {
  clearObservationReapHooksForTesting,
  getObservationReapHooks,
} from "../resolver/observationReapHooks";
import { resetIdentityLinkReapForTesting } from "../resolver/registerIdentityLinkReap";

afterEach(() => clearResolverExtensionsForTesting());

test("registers the built-in sec resolver kinds", () => {
  registerSecResolvers();
  const ids = listResolverIds();
  for (const id of ["person", "company"]) {
    expect(ids).toContain(id);
  }
});

test("families are family-tier, expose coverage, and register no purge", () => {
  registerSecResolvers();
});

test("person/company expose coverage + dropPrevious", () => {
  registerSecResolvers();
  for (const id of ["person", "company"]) {
    expect(isFamilyResolverId(id)).toBe(false);
    expect(typeof getResolverExtension(id)?.coverage).toBe("function");
    expect(typeof getResolverExtension(id)?.dropPrevious).toBe("function");
  }
});

/**
 * The reaper deletes no identity link itself any more — the tier that owns them
 * registers a hook. While that tier ships here, this package's bootstrap is what
 * registers it, and forgetting to would be silent: reap would report the same
 * count, delete the observations, and leave links pointing at rows that are gone
 * until some later rebuild raised on one.
 */
test("bootstrapping registers the hook that reaps identity links", async () => {
  clearObservationReapHooksForTesting();
  resetIdentityLinkReapForTesting();
  expect(getObservationReapHooks()).toHaveLength(0);

  registerSecResolvers();

  expect(getObservationReapHooks()).toHaveLength(1);
});
