/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { CanonicalSponsorFamilyRepo } from "../storage/canonical/CanonicalSponsorFamilyRepo";
import { CanonicalSponsorFamilyAliasRepo } from "../storage/canonical/CanonicalSponsorFamilyAliasRepo";
import { SponsorFamilyResolver } from "./SponsorFamilyResolver";

describe("SponsorFamilyResolver", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("creates one family per normalized common name and reuses it", async () => {
    const resolver = new SponsorFamilyResolver({
      canonicalSponsorFamilyRepo: new CanonicalSponsorFamilyRepo(),
      canonicalSponsorFamilyAliasRepo: new CanonicalSponsorFamilyAliasRepo(),
      activeResolverVersion: "1.0.0",
    });
    const a = await resolver.resolve("Pershing Square Sponsor");
    const b = await resolver.resolve("PERSHING   SQUARE   SPONSOR");
    expect(a).toBe(b);
  });

  it("follows an alias to the merged family", async () => {
    const families = new CanonicalSponsorFamilyRepo();
    const aliases = new CanonicalSponsorFamilyAliasRepo();
    const resolver = new SponsorFamilyResolver({
      canonicalSponsorFamilyRepo: families,
      canonicalSponsorFamilyAliasRepo: aliases,
      activeResolverVersion: "1.0.0",
    });
    const x = await resolver.resolve("Acme Sponsor");
    const y = await resolver.resolve("Acme Sponsors"); // AI variant
    await aliases.add(y, x, "variant", "op");
    expect(await resolver.resolve("Acme Sponsors")).toBe(x);
  });
});
