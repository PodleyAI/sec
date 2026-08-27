/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach } from "vitest";
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
import { isUniqueConstraintError } from "../util/isUniqueConstraintError";

type ErrorShape = "sqlite" | "pg";

function synthesizeUniqueError(shape: ErrorShape): Error {
  if (shape === "sqlite") {
    return new Error(
      "UNIQUE constraint failed: canonical_person.resolver_version, canonical_person.cik"
    );
  }
  return Object.assign(
    new Error(
      'duplicate key value violates unique constraint "canonical_person_uniq_resolver_version_cik"'
    ),
    { code: "23505" }
  );
}

function makeRepos() {
  const canonStorage = new InMemoryTabularStorage<
    typeof CanonicalPersonSchema,
    typeof CanonicalPersonPrimaryKeyNames,
    CanonicalPerson
  >(
    CanonicalPersonSchema,
    CanonicalPersonPrimaryKeyNames,
    [["resolver_version", "normalized_last"]],
    undefined,
    undefined,
    undefined,
    // Mirrors DefaultDI: only CIK is enforced unique. Name tuples are not
    // unique because two distinct CIKs can legitimately share a name.
    [["resolver_version", "cik"]]
  );
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
    relationship: null,
    birth_year: null,
    raw_address_id: null,
    raw_phone_id: null,
    source_context: null,
    bio: null,
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
    const rows = (await setup.canonStorage.getAll()) ?? [];
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
    const rows = (await setup.canonStorage.getAll()) ?? [];
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
    const rows = (await setup.canonStorage.getAll()) ?? [];
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
    const rows = (await setup.canonStorage.getAll()) ?? [];
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

// Multi-process race: a separate `sec` invocation gets its own
// PersonResolver instance, so its instance-scoped `_keyMutexes` does NOT
// serialise against ours. We model that here with TWO PersonResolver
// instances sharing the same underlying repos: each gets its own mutex
// map by construction, so the in-process mutex no longer collapses
// concurrent callers across the two instances. The storage's UNIQUE
// index is then the real thing keeping twin canonical rows from being
// minted, and PersonResolver.resolve()'s UNIQUE-rejection retry path is
// what makes the loser converge on the winner's canonical id instead of
// failing.
// Drives the multi-process race scenario under a chosen storage-error
// shape. We monkey-patch `put` to translate the storage's natural UNIQUE
// rejection into the chosen error shape — proving the resolver's retry
// path recognises both the SQLite/InMemory error shape AND the raw
// Postgres `pg.DatabaseError` shape (`code: "23505"` + the
// "duplicate key value violates unique constraint" message) without
// requiring an actual Postgres connection in the unit suite. The winner
// row stays in place so the loser's re-query converges on it.
async function runMultiProcessRace(opts: {
  errorShape: ErrorShape;
}): Promise<{ uniqueRejections: number; ids: ReadonlySet<string> }> {
  const setup = makeRepos();
  let uniqueRejections = 0;
  const originalPut = setup.canonStorage.put.bind(setup.canonStorage);
  setup.canonStorage.put = async (value) => {
    try {
      return await originalPut(value);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        uniqueRejections += 1;
        throw synthesizeUniqueError(opts.errorShape);
      }
      throw err;
    }
  };

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

  const fanout = 50;
  const results = await Promise.all(
    Array.from({ length: fanout }, (_, i) => {
      const r = i % 2 === 0 ? resolverA : resolverB;
      return r.resolve(obs({ cik: 5555, observation_id: i + 1 }));
    })
  );
  const rows = (await setup.canonStorage.getAll()) ?? [];
  expect(rows.length).toBe(1);
  return { uniqueRejections, ids: new Set(results) };
}

describe("PersonResolver multi-process race (storage-level UNIQUE constraint)", () => {
  beforeEach(async () => {
    // Fail loud if a future workglow regression silently drops UNIQUE
    // enforcement — the rest of the suite assumes the storage layer is the
    // backstop when the in-process AsyncMutex is bypassed.
    const enforces = await storageEnforcesPersonUniqueness();
    expect(enforces).toBe(true);
    // Also sanity-check that the SQLite/InMemory shape the storage layer
    // actually throws is still recognised by the resolver's helper. If
    // workglow ever changes the wording, this asserts loudly here
    // instead of silently breaking the retry path in production.
    const sample = new Error(
      "UNIQUE constraint failed: canonical_person.resolver_version, canonical_person.cik"
    );
    expect(isUniqueConstraintError(sample)).toBe(true);
  });

  it("twin resolver instances racing the same CIK collapse to one row (SQLite/InMemory error shape)", async () => {
    const { uniqueRejections, ids } = await runMultiProcessRace({
      errorShape: "sqlite",
    });
    expect(ids.size).toBe(1);
    expect(uniqueRejections).toBeGreaterThanOrEqual(1);
  });

  it("twin resolver instances racing the same CIK collapse to one row (Postgres error shape)", async () => {
    const { uniqueRejections, ids } = await runMultiProcessRace({
      errorShape: "pg",
    });
    expect(ids.size).toBe(1);
    expect(uniqueRejections).toBeGreaterThanOrEqual(1);
  });

  // No name-race counterpart: the (resolver_version, normalized_name, ...)
  // tuple is intentionally NOT a storage-level UNIQUE constraint because
  // two distinct CIKs can legitimately share a name. The in-process
  // AsyncMutex is the only collapse mechanism for name-only resolution;
  // multi-process callers can race and mint duplicate rows.
});
