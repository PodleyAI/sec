/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { CanonicalUnderwriterFamilyRepo } from "../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { CanonicalUnderwriterFamilyAliasRepo } from "../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import { UnderwriterFamilyResolver } from "./UnderwriterFamilyResolver";

describe("UnderwriterFamilyResolver", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("creates one family per normalized common name and reuses it", async () => {
    const resolver = new UnderwriterFamilyResolver({
      canonicalUnderwriterFamilyRepo: new CanonicalUnderwriterFamilyRepo(),
      canonicalUnderwriterFamilyAliasRepo: new CanonicalUnderwriterFamilyAliasRepo(),
      activeResolverVersion: "1.0.0",
    });
    const a = await resolver.resolve("Goldman Sachs");
    const b = await resolver.resolve("GOLDMAN   SACHS");
    expect(a).toBe(b);
  });

  it("follows an alias to the merged family", async () => {
    const families = new CanonicalUnderwriterFamilyRepo();
    const aliases = new CanonicalUnderwriterFamilyAliasRepo();
    const resolver = new UnderwriterFamilyResolver({
      canonicalUnderwriterFamilyRepo: families,
      canonicalUnderwriterFamilyAliasRepo: aliases,
      activeResolverVersion: "1.0.0",
    });
    const x = await resolver.resolve("Morgan Stanley");
    const y = await resolver.resolve("Morgan Stanley & Co.");
    await aliases.add(y, x, "variant", "op");
    expect(await resolver.resolve("Morgan Stanley & Co.")).toBe(x);
  });
});
