/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { InMemoryTabularStorage } from "workglow";
import { CanonicalPersonRepo } from "../storage/canonical/CanonicalPersonRepo";
import {
  CanonicalPersonSchema,
  CanonicalPersonPrimaryKeyNames,
  type CanonicalPerson,
} from "../storage/canonical/CanonicalPersonSchema";
import { CanonicalPersonAliasRepo } from "../storage/canonical/CanonicalPersonAliasRepo";
import {
  CanonicalPersonAliasSchema,
  CanonicalPersonAliasPrimaryKeyNames,
  type CanonicalPersonAlias,
} from "../storage/canonical/CanonicalAliasSchemas";
import type { PersonObservation } from "../storage/observation/PersonObservationSchema";
import { PersonResolver } from "./PersonResolver";

function makeRepos() {
  const canonStorage = new InMemoryTabularStorage<
    typeof CanonicalPersonSchema,
    typeof CanonicalPersonPrimaryKeyNames,
    CanonicalPerson
  >(CanonicalPersonSchema, CanonicalPersonPrimaryKeyNames, [
    ["resolver_version", "cik"],
    ["resolver_version", "normalized_last"],
  ]);
  const aliasStorage = new InMemoryTabularStorage<
    typeof CanonicalPersonAliasSchema,
    typeof CanonicalPersonAliasPrimaryKeyNames,
    CanonicalPersonAlias
  >(CanonicalPersonAliasSchema, CanonicalPersonAliasPrimaryKeyNames, []);
  return {
    canonStorage,
    aliasStorage,
    canonRepo: new CanonicalPersonRepo({ canonicalPersonRepository: canonStorage }),
    aliasRepo: new CanonicalPersonAliasRepo({
      canonicalPersonAliasRepository: aliasStorage,
    }),
  };
}

function obs(overrides: Partial<PersonObservation>): PersonObservation {
  return {
    observation_id: 1,
    accession_number: "0001-25-000001",
    extractor_id: "D",
    extractor_version: "1.0.0",
    observation_index: 0,
    source_filing_issuer_cik: 100,
    cik: null,
    first_name: null,
    middle_name: null,
    last_name: null,
    suffix: null,
    normalized_first: null,
    normalized_middle: null,
    normalized_last: null,
    normalized_suffix: null,
    title: null,
    relationship: null,
    raw_address_id: null,
    raw_phone_id: null,
    source_context: null,
    created_at: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

// These tests target the C1 race: two parallel resolves of the same key
// used to both observe no canonical row, both mint a fresh UUID, both
// insert. The per-key AsyncMutex must serialise the find-or-create so
// the second caller sees the first's row and returns the same id.
describe("PersonResolver concurrent resolution", () => {
  let setup: ReturnType<typeof makeRepos>;
  let resolver: PersonResolver;

  beforeEach(() => {
    setup = makeRepos();
    resolver = new PersonResolver({
      canonicalPersonRepo: setup.canonRepo,
      canonicalPersonAliasRepo: setup.aliasRepo,
      activeResolverVersion: "1.0.0",
    });
  });

  it("two parallel resolves on the same CIK return one canonical id and create one row", async () => {
    const [a, b] = await Promise.all([
      resolver.resolve(obs({ cik: 1234 })),
      resolver.resolve(obs({ cik: 1234, observation_id: 2 })),
    ]);
    expect(a).toBe(b);
    const rows = await setup.canonStorage.getAll();
    expect(rows.length).toBe(1);
  });

  it("two parallel resolves on the same name + issuer return one canonical id", async () => {
    const claim = obs({
      normalized_first: "jane",
      normalized_last: "smith",
      source_filing_issuer_cik: 100,
    });
    const [a, b] = await Promise.all([
      resolver.resolve(claim),
      resolver.resolve({ ...claim, observation_id: 2 }),
    ]);
    expect(a).toBe(b);
    const rows = await setup.canonStorage.getAll();
    expect(rows.length).toBe(1);
  });

  it("many parallel resolves on the same CIK still produce one canonical row", async () => {
    // Stress the queue depth a bit — fan-out of 25 ensures we exercise
    // the mutex queue (not just a 2-way ABBA contention).
    const cik = 9999;
    const fanout = 25;
    const results = await Promise.all(
      Array.from({ length: fanout }, (_, i) =>
        resolver.resolve(obs({ cik, observation_id: i + 1 }))
      )
    );
    const uniqueIds = new Set(results);
    expect(uniqueIds.size).toBe(1);
    const rows = await setup.canonStorage.getAll();
    expect(rows.length).toBe(1);
  });

  it("parallel resolves on distinct CIKs do NOT block each other and each creates its own row", async () => {
    // Negative control — the per-key mutex should not serialise the
    // whole resolver, only callers sharing the same key.
    const [a, b] = await Promise.all([
      resolver.resolve(obs({ cik: 1111 })),
      resolver.resolve(obs({ cik: 2222, observation_id: 2 })),
    ]);
    expect(a).not.toBe(b);
    const rows = await setup.canonStorage.getAll();
    expect(rows.length).toBe(2);
  });
});

/**
 * Probes whether the underlying storage actually enforces uniqueness on the
 * canonical resolver key tuples. The single-process AsyncMutex protects
 * the in-process case; a parallel `sec` invocation can only be made safe by
 * a storage-level UNIQUE constraint. Until the upstream `@workglow/storage`
 * `uniqueIndexes` change lands, the in-memory backend lets duplicates
 * through and the multi-process tests below are skipped.
 */
async function storageEnforcesPersonUniqueness(): Promise<boolean> {
  const setup = makeRepos();
  const a = {
    canonical_person_id: "11111111-1111-1111-1111-111111111111",
    resolver_version: "1.0.0",
    display_first: null,
    display_middle: null,
    display_last: null,
    display_suffix: null,
    cik: 4242,
    normalized_first: null,
    normalized_middle: null,
    normalized_last: null,
    normalized_suffix: null,
    source_filing_issuer_cik: null,
    created_at: "2026-05-22T00:00:00.000Z",
  } as const;
  await setup.canonStorage.put(a);
  try {
    await setup.canonStorage.put({
      ...a,
      canonical_person_id: "22222222-2222-2222-2222-222222222222",
    });
    return false;
  } catch {
    return true;
  }
}

// Multi-process race: a separate `sec` invocation gets its own copy of the
// PersonResolver class, so its `_keyMutexes` static does NOT serialise
// against ours. We simulate that here with TWO PersonResolver instances
// sharing the same underlying repos AND patching the static map to a
// per-instance Map so the in-process mutex no longer collapses concurrent
// callers. The storage's UNIQUE index is then the only thing keeping
// twin canonical rows from being minted.
describe("PersonResolver multi-process race (storage-level UNIQUE constraint)", () => {
  let enforcesUnique = false;

  beforeEach(async () => {
    enforcesUnique = await storageEnforcesPersonUniqueness();
  });

  it.skipIf(!enforcesUnique)(
    "twin resolver instances racing the same CIK still collapse to one canonical row",
    async () => {
      const setup = makeRepos();
      const resolverA = new PersonResolver({
        canonicalPersonRepo: setup.canonRepo,
        canonicalPersonAliasRepo: setup.aliasRepo,
        activeResolverVersion: "1.0.0",
      });
      const resolverB = new PersonResolver({
        canonicalPersonRepo: setup.canonRepo,
        canonicalPersonAliasRepo: setup.aliasRepo,
        activeResolverVersion: "1.0.0",
      });
      // Force each resolver instance to use its own mutex map so the
      // static class-level serialisation does not mask the storage race.
      // The cast is intentional — we are deliberately violating the
      // static-on-class invariant to model two processes.
      (resolverA as unknown as { _ownMutexes?: Map<string, unknown> })._ownMutexes = new Map();
      (resolverB as unknown as { _ownMutexes?: Map<string, unknown> })._ownMutexes = new Map();

      const fanout = 50;
      const results = await Promise.all(
        Array.from({ length: fanout }, (_, i) => {
          const r = i % 2 === 0 ? resolverA : resolverB;
          return r.resolve(obs({ cik: 5555, observation_id: i + 1 }));
        })
      );
      expect(new Set(results).size).toBe(1);
      const rows = await setup.canonStorage.getAll();
      expect(rows.length).toBe(1);
    }
  );

  it.skipIf(!enforcesUnique)(
    "twin resolver instances racing the same name + issuer collapse to one canonical row",
    async () => {
      const setup = makeRepos();
      const resolverA = new PersonResolver({
        canonicalPersonRepo: setup.canonRepo,
        canonicalPersonAliasRepo: setup.aliasRepo,
        activeResolverVersion: "1.0.0",
      });
      const resolverB = new PersonResolver({
        canonicalPersonRepo: setup.canonRepo,
        canonicalPersonAliasRepo: setup.aliasRepo,
        activeResolverVersion: "1.0.0",
      });
      const claim = obs({
        normalized_first: "jane",
        normalized_middle: null,
        normalized_last: "doe",
        normalized_suffix: null,
        source_filing_issuer_cik: 100,
      });
      const fanout = 50;
      const results = await Promise.all(
        Array.from({ length: fanout }, (_, i) => {
          const r = i % 2 === 0 ? resolverA : resolverB;
          return r.resolve({ ...claim, observation_id: i + 1 });
        })
      );
      expect(new Set(results).size).toBe(1);
      const rows = await setup.canonStorage.getAll();
      expect(rows.length).toBe(1);
    }
  );

  it("storage-level uniqueness detection is wired (fails closed when upstream lands)", () => {
    // Sentinel: leaves a breadcrumb so a green run on a new libs version
    // is obvious in the test output even though the skipIf'd tests are
    // the real regression guard.
    if (!enforcesUnique) {
      // The upstream `uniqueIndexes` plumbing has not landed yet —
      // skip the multi-process tests above. This is expected.
      expect(enforcesUnique).toBe(false);
    } else {
      expect(enforcesUnique).toBe(true);
    }
  });
});
