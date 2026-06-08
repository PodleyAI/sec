/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { CanonicalSponsorFamilyRepo } from "../storage/canonical/CanonicalSponsorFamilyRepo";
import { CanonicalSponsorFamilyAliasRepo } from "../storage/canonical/CanonicalSponsorFamilyAliasRepo";
import type { CanonicalSponsorFamily } from "../storage/canonical/CanonicalSponsorFamilySchema";
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

  it("serialises alias lookup inside the per-key mutex (no overlapping alias.resolve calls)", async () => {
    // Pre-fix code ran alias.resolve OUTSIDE the per-key mutex, so two parallel
    // resolves on the same family name overlapped in time on alias.resolve.
    // Post-fix code runs it INSIDE the mutex so the alias lookups serialise.
    // We measure that window directly via an in-flight counter.
    const families = new CanonicalSponsorFamilyRepo();
    const aliases = new CanonicalSponsorFamilyAliasRepo();
    const resolver = new SponsorFamilyResolver({
      canonicalSponsorFamilyRepo: families,
      canonicalSponsorFamilyAliasRepo: aliases,
      activeResolverVersion: "1.0.0",
    });

    const originalCreate = families.create.bind(families);
    let createCount = 0;
    families.create = (async (row: CanonicalSponsorFamily) => {
      createCount += 1;
      return originalCreate(row);
    }) as typeof families.create;

    let inFlight = 0;
    let maxInFlight = 0;
    let aliasCallCount = 0;
    aliases.resolve = async (id: string) => {
      inFlight += 1;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      aliasCallCount += 1;
      // Sleep long enough that a parallel caller is guaranteed to start
      // before this one resolves.
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return id; // alias not installed — we only care about the in-flight window
    };

    await Promise.all([
      resolver.resolve("Pershing Square Sponsor"),
      resolver.resolve("Pershing Square Sponsor"),
    ]);

    // Post-fix: alias lookup is inside the mutex → at most one in flight.
    // Pre-fix: alias lookup is after mutex.release → both run in parallel.
    expect(maxInFlight).toBe(1);
    expect(aliasCallCount).toBe(2);
    // Exactly one canonical row was minted — find-or-create remains serialised.
    expect(createCount).toBe(1);
  });
});
