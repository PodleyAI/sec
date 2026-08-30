/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import { CanonicalSponsorFamilyRepo } from "../storage/canonical/CanonicalSponsorFamilyRepo";
import {
  CanonicalSponsorFamilySchema,
  CanonicalSponsorFamilyPrimaryKeyNames,
  type CanonicalSponsorFamily,
} from "../storage/canonical/CanonicalSponsorFamilySchema";
import { CanonicalSponsorFamilyAliasRepo } from "../storage/canonical/CanonicalSponsorFamilyAliasRepo";
import {
  CanonicalSponsorFamilyAliasSchema,
  CanonicalSponsorFamilyAliasPrimaryKeyNames,
  type CanonicalSponsorFamilyAlias,
  CanonicalUnderwriterFamilyAliasSchema,
  CanonicalUnderwriterFamilyAliasPrimaryKeyNames,
  type CanonicalUnderwriterFamilyAlias,
} from "../storage/canonical/CanonicalFamilyAliasSchemas";
import { CanonicalUnderwriterFamilyRepo } from "../storage/canonical/CanonicalUnderwriterFamilyRepo";
import {
  CanonicalUnderwriterFamilySchema,
  CanonicalUnderwriterFamilyPrimaryKeyNames,
  type CanonicalUnderwriterFamily,
} from "../storage/canonical/CanonicalUnderwriterFamilySchema";
import { CanonicalUnderwriterFamilyAliasRepo } from "../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import { SponsorFamilyResolver } from "./SponsorFamilyResolver";
import { UnderwriterFamilyResolver } from "./UnderwriterFamilyResolver";

interface FamilyTestKit<Resolver> {
  readonly kind: "sponsor" | "underwriter";
  readonly canonStorage: InMemoryTabularStorage<any, any, any>;
  readonly makeResolver: () => Resolver;
  /** Resolve a single common name through the resolver under test. */
  readonly resolve: (resolver: Resolver, name: string) => Promise<string>;
}

function makeSponsorKit(): FamilyTestKit<SponsorFamilyResolver> {
  const canonStorage = new InMemoryTabularStorage<
    typeof CanonicalSponsorFamilySchema,
    typeof CanonicalSponsorFamilyPrimaryKeyNames,
    CanonicalSponsorFamily
  >(
    CanonicalSponsorFamilySchema,
    CanonicalSponsorFamilyPrimaryKeyNames,
    [],
    undefined,
    undefined,
    undefined,
    // Mirrors DefaultDI / TestingDI post-fix wiring: (resolver_version,
    // normalized_name) is the family natural key.
    [["resolver_version", "normalized_name"]]
  );
  const aliasStorage = new InMemoryTabularStorage<
    typeof CanonicalSponsorFamilyAliasSchema,
    typeof CanonicalSponsorFamilyAliasPrimaryKeyNames,
    CanonicalSponsorFamilyAlias
  >(CanonicalSponsorFamilyAliasSchema, CanonicalSponsorFamilyAliasPrimaryKeyNames, []);
  const canonRepo = new CanonicalSponsorFamilyRepo(canonStorage);
  const aliasRepo = new CanonicalSponsorFamilyAliasRepo({ repository: aliasStorage });
  return {
    kind: "sponsor",
    canonStorage,
    makeResolver: () =>
      new SponsorFamilyResolver({
        canonicalSponsorFamilyRepo: canonRepo,
        canonicalSponsorFamilyAliasRepo: aliasRepo,
        activeResolverVersion: "1.0.0",
      }),
    resolve: (r, name) => r.resolve(name),
  };
}

function makeUnderwriterKit(): FamilyTestKit<UnderwriterFamilyResolver> {
  const canonStorage = new InMemoryTabularStorage<
    typeof CanonicalUnderwriterFamilySchema,
    typeof CanonicalUnderwriterFamilyPrimaryKeyNames,
    CanonicalUnderwriterFamily
  >(
    CanonicalUnderwriterFamilySchema,
    CanonicalUnderwriterFamilyPrimaryKeyNames,
    [],
    undefined,
    undefined,
    undefined,
    [["resolver_version", "normalized_name"]]
  );
  const aliasStorage = new InMemoryTabularStorage<
    typeof CanonicalUnderwriterFamilyAliasSchema,
    typeof CanonicalUnderwriterFamilyAliasPrimaryKeyNames,
    CanonicalUnderwriterFamilyAlias
  >(CanonicalUnderwriterFamilyAliasSchema, CanonicalUnderwriterFamilyAliasPrimaryKeyNames, []);
  const canonRepo = new CanonicalUnderwriterFamilyRepo(canonStorage);
  const aliasRepo = new CanonicalUnderwriterFamilyAliasRepo({ repository: aliasStorage });
  return {
    kind: "underwriter",
    canonStorage,
    makeResolver: () =>
      new UnderwriterFamilyResolver({
        canonicalUnderwriterFamilyRepo: canonRepo,
        canonicalUnderwriterFamilyAliasRepo: aliasRepo,
        activeResolverVersion: "1.0.0",
      }),
    resolve: (r, name) => r.resolve(name),
  };
}

/**
 * Probes whether the underlying storage actually enforces the family natural
 * key. This is the unit test that pins the DefaultDI / TestingDI fix — if a
 * future refactor drops `uniqueIndexes` for family tables, this assertion
 * fires before the multi-process race tests below.
 */
async function storageEnforcesFamilyUniqueness(
  canonStorage: InMemoryTabularStorage<any, any, any>,
  idField: string
): Promise<boolean> {
  const a: Record<string, unknown> = {
    [idField]: "11111111-1111-1111-1111-111111111111",
    resolver_version: "1.0.0",
    display_name: "Goldman Sachs",
    normalized_name: "GOLDMAN SACHS",
    created_at: "2026-05-22T00:00:00.000Z",
  };
  await canonStorage.put(a);
  try {
    await canonStorage.put({
      ...a,
      [idField]: "22222222-2222-2222-2222-222222222222",
    });
    return false;
  } catch {
    return true;
  }
}

// Synthesised error shapes per backend — both backends surface UNIQUE
// rejections through `@workglow/storage` with the same `StorageError`
// message prefix that `isUniqueConstraintError` matches.
const ERROR_SHAPES = {
  sqlite: () =>
    new Error(
      "UNIQUE constraint failed: canonical_*_family.resolver_version, canonical_*_family.normalized_name"
    ),
  pg: () =>
    new Error(
      "UNIQUE constraint failed (postgres unique_violation 23505): duplicate key on (resolver_version, normalized_name)"
    ),
} as const;

type ErrorShape = keyof typeof ERROR_SHAPES;

function describeFamilyRaces<R>(
  label: string,
  buildKit: () => FamilyTestKit<R>,
  idField: string
): void {
  describe(`${label} concurrent resolution`, () => {
    let kit: FamilyTestKit<R>;
    let resolver: R;

    beforeEach(async () => {
      kit = buildKit();
      // Fail loud if a future workglow regression silently drops UNIQUE
      // enforcement on the family table — the multi-process race tests
      // assume the storage layer is the backstop when twin instance
      // mutexes don't collapse contention.
      const enforces = await storageEnforcesFamilyUniqueness(kit.canonStorage, idField);
      expect(enforces).toBe(true);
      // Rebuild for the actual race tests (the probe row would otherwise
      // pollute getAll()).
      kit = buildKit();
      resolver = kit.makeResolver();
    });

    it("two parallel resolves on the same family name return one canonical id and create one row", async () => {
      const [a, b] = await Promise.all([
        kit.resolve(resolver, "Goldman Sachs"),
        kit.resolve(resolver, "Goldman   Sachs"),
      ]);
      expect(a).toBe(b);
      const rows = (await kit.canonStorage.getAll()) ?? [];
      expect(rows.length).toBe(1);
    });

    it("many parallel resolves on the same family name still produce one canonical row", async () => {
      const fanout = 25;
      const results = await Promise.all(
        Array.from({ length: fanout }, () => kit.resolve(resolver, "Pershing Square Sponsor"))
      );
      expect(new Set(results).size).toBe(1);
      const rows = (await kit.canonStorage.getAll()) ?? [];
      expect(rows.length).toBe(1);
    });

    function runMultiProcessRace({ errorShape }: { errorShape: ErrorShape }): void {
      it(`twin resolver instances racing the same family name converge under ${errorShape} UNIQUE rejection`, async () => {
        const localKit = buildKit();
        // Count UNIQUE rejections at the storage layer so we assert the
        // backstop actually fires — proves the test exercises the storage
        // UNIQUE retry path, not just an accidental id match.
        let uniqueRejections = 0;
        const originalPut = localKit.canonStorage.put.bind(localKit.canonStorage);
        localKit.canonStorage.put = async (value: any) => {
          // Let the real put run; if it succeeds, we mimic a multi-process
          // race only when the underlying storage actually rejected the
          // call (i.e. another writer already inserted a row with the same
          // natural key). The InMemory storage UNIQUE constraint surfaces
          // the rejection naturally — we just re-throw it under the
          // requested backend message shape so the consumer (which
          // matches on the message prefix) treats both alike.
          try {
            return await originalPut(value);
          } catch (err) {
            const msg =
              err !== null &&
              typeof err === "object" &&
              typeof (err as { message?: unknown }).message === "string"
                ? (err as { message: string }).message
                : "";
            if (msg.startsWith("UNIQUE constraint failed")) {
              uniqueRejections += 1;
              throw ERROR_SHAPES[errorShape]();
            }
            throw err;
          }
        };

        const resolverA = localKit.makeResolver();
        const resolverB = localKit.makeResolver();

        const fanout = 20;
        const results = await Promise.all(
          Array.from({ length: fanout }, (_, i) => {
            const r = i % 2 === 0 ? resolverA : resolverB;
            return localKit.resolve(r, "Apollo Sponsor");
          })
        );

        const ids = new Set(results);
        expect(ids.size).toBe(1);
        const rows = (await localKit.canonStorage.getAll()) ?? [];
        expect(rows.length).toBe(1);
        // At least one storage-level UNIQUE rejection must have fired —
        // otherwise the two instances accidentally never raced and the
        // test doesn't exercise the multi-process backstop.
        expect(uniqueRejections).toBeGreaterThanOrEqual(1);
      });
    }

    runMultiProcessRace({ errorShape: "sqlite" });
    runMultiProcessRace({ errorShape: "pg" });
  });
}

describeFamilyRaces("SponsorFamilyResolver", makeSponsorKit, "canonical_sponsor_family_id");
describeFamilyRaces(
  "UnderwriterFamilyResolver",
  makeUnderwriterKit,
  "canonical_underwriter_family_id"
);
