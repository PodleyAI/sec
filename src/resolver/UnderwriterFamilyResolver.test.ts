/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { CanonicalUnderwriterFamilyRepo } from "../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { CanonicalUnderwriterFamilyAliasRepo } from "../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import type { CanonicalUnderwriterFamily } from "../storage/canonical/CanonicalUnderwriterFamilySchema";
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
    // `Morgan Stanley` / `Morgan Stanley & Co.` no longer need an alias — the
    // normalizer unifies them, since `& Co.` is a legal form and a stranded
    // conjunction. What still needs one is a business-line join, which the
    // normalizer deliberately refuses to guess at.
    expect(await resolver.resolve("Morgan Stanley")).toBe(
      await resolver.resolve("Morgan Stanley & Co.")
    );

    const x = await resolver.resolve("Chardan");
    const y = await resolver.resolve("Chardan Capital Markets LLC");
    expect(y).not.toBe(x);
    await aliases.add(y, x, "variant", "op");
    expect(await resolver.resolve("Chardan Capital Markets LLC")).toBe(x);
  });

  it("serialises alias lookup inside the per-key mutex (no overlapping alias.resolve calls)", async () => {
    // Pre-fix code ran alias.resolve OUTSIDE the per-key mutex, so two parallel
    // resolves on the same family name overlapped in time on alias.resolve.
    // Post-fix code runs it INSIDE the mutex so the alias lookups serialise.
    // We measure that window directly via an in-flight counter.
    const families = new CanonicalUnderwriterFamilyRepo();
    const aliases = new CanonicalUnderwriterFamilyAliasRepo();
    const resolver = new UnderwriterFamilyResolver({
      canonicalUnderwriterFamilyRepo: families,
      canonicalUnderwriterFamilyAliasRepo: aliases,
      activeResolverVersion: "1.0.0",
    });

    const originalCreate = families.create.bind(families);
    let createCount = 0;
    families.create = (async (row: CanonicalUnderwriterFamily) => {
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

    await Promise.all([resolver.resolve("Goldman Sachs"), resolver.resolve("Goldman Sachs")]);

    // Post-fix: alias lookup is inside the mutex → at most one in flight.
    // Pre-fix: alias lookup is after mutex.release → both run in parallel.
    expect(maxInFlight).toBe(1);
    expect(aliasCallCount).toBe(2);
    // Exactly one canonical row was minted — find-or-create remains serialised.
    expect(createCount).toBe(1);
  });
});
