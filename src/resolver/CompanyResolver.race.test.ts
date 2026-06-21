/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { InMemoryTabularStorage } from "workglow";
import { CanonicalCompanyRepo } from "../storage/canonical/CanonicalCompanyRepo";
import {
  CanonicalCompanySchema,
  CanonicalCompanyPrimaryKeyNames,
  type CanonicalCompany,
} from "../storage/canonical/CanonicalCompanySchema";
import { CanonicalCompanyAliasRepo } from "../storage/canonical/CanonicalCompanyAliasRepo";
import {
  CanonicalCompanyAliasSchema,
  CanonicalCompanyAliasPrimaryKeyNames,
  type CanonicalCompanyAlias,
} from "../storage/canonical/CanonicalAliasSchemas";
import type { CompanyObservation } from "../storage/observation/CompanyObservationSchema";
import { CompanyResolver } from "./CompanyResolver";
import { isUniqueConstraintError } from "./isUniqueConstraintError";

type ErrorShape = "sqlite" | "pg";
type CompanyKey = "cik" | "crd";

function synthesizeUniqueError(shape: ErrorShape, key: CompanyKey): Error {
  if (shape === "sqlite") {
    const cols =
      key === "cik"
        ? "canonical_company.resolver_version, canonical_company.cik"
        : "canonical_company.resolver_version, canonical_company.crd_number";
    return new Error(`UNIQUE constraint failed: ${cols}`);
  }
  const constraintName =
    key === "cik"
      ? "canonical_company_uniq_resolver_version_cik"
      : "canonical_company_uniq_resolver_version_crd_number";
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraintName}"`),
    { code: "23505" }
  );
}

function makeRepos() {
  const canonStorage = new InMemoryTabularStorage<
    typeof CanonicalCompanySchema,
    typeof CanonicalCompanyPrimaryKeyNames,
    CanonicalCompany
  >(
    CanonicalCompanySchema,
    CanonicalCompanyPrimaryKeyNames,
    [],
    undefined,
    undefined,
    undefined,
    // Mirrors DefaultDI: CIK + CRD are enforced unique. normalized_name is
    // NOT unique because two distinct CIKs can legitimately share a name.
    [
      ["resolver_version", "cik"],
      ["resolver_version", "crd_number"],
    ]
  );
  const aliasStorage = new InMemoryTabularStorage<
    typeof CanonicalCompanyAliasSchema,
    typeof CanonicalCompanyAliasPrimaryKeyNames,
    CanonicalCompanyAlias
  >(CanonicalCompanyAliasSchema, CanonicalCompanyAliasPrimaryKeyNames, []);
  return {
    canonRepo: new CanonicalCompanyRepo({ canonicalCompanyRepository: canonStorage }),
    aliasRepo: new CanonicalCompanyAliasRepo({
      canonicalCompanyAliasRepository: aliasStorage,
    }),
    canonStorage,
  };
}

function obs(overrides: Partial<CompanyObservation>): CompanyObservation {
  return {
    observation_id: 1,
    accession_number: "0001-25-000001",
    extractor_id: "D",
    extractor_version: "1.0.0",
    observation_index: 0,
    cik: null,
    crd_number: null,
    name: null,
    normalized_name: null,
    jurisdiction: null,
    entity_type: null,
    raw_address_id: null,
    raw_phone_id: null,
    source_context: null,
    created_at: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

// Companion of PersonResolver.race.test.ts — covers each of the three
// key kinds (CIK, CRD, normalized name).
describe("CompanyResolver concurrent resolution", () => {
  let setup: ReturnType<typeof makeRepos>;
  let resolver: CompanyResolver;

  beforeEach(() => {
    setup = makeRepos();
    resolver = new CompanyResolver({
      canonicalCompanyRepo: setup.canonRepo,
      canonicalCompanyAliasRepo: setup.aliasRepo,
      activeResolverVersion: "1.0.0",
    });
  });

  it("two parallel resolves on the same CIK collapse to one canonical row", async () => {
    const [a, b] = await Promise.all([
      resolver.resolve(obs({ cik: 1234 })),
      resolver.resolve(obs({ cik: 1234, observation_id: 2 })),
    ]);
    expect(a).toBe(b);
    expect((await setup.canonStorage.getAll()).length).toBe(1);
  });

  it("two parallel resolves on the same CRD collapse to one canonical row", async () => {
    const [a, b] = await Promise.all([
      resolver.resolve(obs({ crd_number: "CRD-A1" })),
      resolver.resolve(obs({ crd_number: "CRD-A1", observation_id: 2 })),
    ]);
    expect(a).toBe(b);
    expect((await setup.canonStorage.getAll()).length).toBe(1);
  });

  it("two parallel resolves on the same normalized name collapse to one canonical row", async () => {
    const [a, b] = await Promise.all([
      resolver.resolve(obs({ normalized_name: "acme holdings llc" })),
      resolver.resolve(
        obs({ normalized_name: "acme holdings llc", observation_id: 2 })
      ),
    ]);
    expect(a).toBe(b);
    expect((await setup.canonStorage.getAll()).length).toBe(1);
  });

  it("many parallel resolves on the same CIK still produce one canonical row", async () => {
    const cik = 7777;
    const fanout = 20;
    const results = await Promise.all(
      Array.from({ length: fanout }, (_, i) =>
        resolver.resolve(obs({ cik, observation_id: i + 1 }))
      )
    );
    expect(new Set(results).size).toBe(1);
    expect((await setup.canonStorage.getAll()).length).toBe(1);
  });

  it("parallel resolves on distinct CIKs each get their own canonical row", async () => {
    const [a, b] = await Promise.all([
      resolver.resolve(obs({ cik: 1111 })),
      resolver.resolve(obs({ cik: 2222, observation_id: 2 })),
    ]);
    expect(a).not.toBe(b);
    expect((await setup.canonStorage.getAll()).length).toBe(2);
  });
});

/**
 * Probes whether the underlying storage enforces uniqueness on the
 * canonical_company resolver-key tuples. The single-process AsyncMutex
 * covers the in-process case; a parallel `sec` invocation can only be made
 * safe by a storage-level UNIQUE constraint. Until the upstream
 * `@workglow/storage` `uniqueIndexes` change lands, the in-memory backend
 * lets duplicates through and the multi-process tests below are skipped.
 */
async function storageEnforcesCompanyUniqueness(): Promise<boolean> {
  const setup = makeRepos();
  const a = {
    canonical_company_id: "11111111-1111-1111-1111-111111111111",
    resolver_version: "1.0.0",
    display_name: null,
    cik: 4242,
    crd_number: null,
    normalized_name: null,
    created_at: "2026-05-22T00:00:00.000Z",
  } as const;
  await setup.canonStorage.put(a);
  try {
    await setup.canonStorage.put({
      ...a,
      canonical_company_id: "22222222-2222-2222-2222-222222222222",
    });
    return false;
  } catch {
    return true;
  }
}

// Multi-process race: a separate `sec` invocation has its own
// CompanyResolver instance with its own instance-scoped `_keyMutexes`
// map, so the in-process mutex does NOT serialise across instances. We
// model that here with TWO CompanyResolver instances sharing the same
// underlying repos. The storage's UNIQUE index is the real thing
// keeping twin canonical rows from being minted, and the resolver's
// UNIQUE-rejection retry path is what makes the loser converge on the
// winner's canonical id instead of failing.
// See PersonResolver.race.test.ts for the rationale. We additionally
// parameterise over the key kind because the canonical_company table has
// UNIQUE indexes on BOTH (resolver_version, cik) and
// (resolver_version, crd_number). Postgres includes the constraint name
// in the error message, so the test exercises both constraint-name forms.
async function runMultiProcessRace(opts: {
  errorShape: ErrorShape;
  key: CompanyKey;
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
        throw synthesizeUniqueError(opts.errorShape, opts.key);
      }
      throw err;
    }
  };

  const resolverA = new CompanyResolver({
    canonicalCompanyRepo: setup.canonRepo,
    canonicalCompanyAliasRepo: setup.aliasRepo,
    activeResolverVersion: "1.0.0",
  });
  const resolverB = new CompanyResolver({
    canonicalCompanyRepo: setup.canonRepo,
    canonicalCompanyAliasRepo: setup.aliasRepo,
    activeResolverVersion: "1.0.0",
  });
  const fanout = 50;
  const results = await Promise.all(
    Array.from({ length: fanout }, (_, i) => {
      const r = i % 2 === 0 ? resolverA : resolverB;
      const claim =
        opts.key === "cik"
          ? obs({ cik: 5555, observation_id: i + 1 })
          : obs({ crd_number: "CRD-RACE-1", observation_id: i + 1 });
      return r.resolve(claim);
    })
  );
  const rows = await setup.canonStorage.getAll();
  expect(rows.length).toBe(1);
  return { uniqueRejections, ids: new Set(results) };
}

describe("CompanyResolver multi-process race (storage-level UNIQUE constraint)", () => {
  beforeEach(async () => {
    // Fail loud if a future workglow regression silently drops UNIQUE
    // enforcement — the rest of the suite assumes the storage layer is the
    // backstop when the in-process AsyncMutex is bypassed.
    const enforces = await storageEnforcesCompanyUniqueness();
    expect(enforces).toBe(true);
    // Sanity check: the resolver's helper still recognises the
    // SQLite/InMemory shape the storage actually throws today.
    const sample = new Error(
      "UNIQUE constraint failed: canonical_company.resolver_version, canonical_company.cik"
    );
    expect(isUniqueConstraintError(sample)).toBe(true);
  });

  it("twin resolver instances racing the same CIK collapse to one row (SQLite/InMemory error shape)", async () => {
    const { uniqueRejections, ids } = await runMultiProcessRace({
      errorShape: "sqlite",
      key: "cik",
    });
    expect(ids.size).toBe(1);
    expect(uniqueRejections).toBeGreaterThanOrEqual(1);
  });

  it("twin resolver instances racing the same CIK collapse to one row (Postgres error shape)", async () => {
    const { uniqueRejections, ids } = await runMultiProcessRace({
      errorShape: "pg",
      key: "cik",
    });
    expect(ids.size).toBe(1);
    expect(uniqueRejections).toBeGreaterThanOrEqual(1);
  });

  it("twin resolver instances racing the same CRD collapse to one row (SQLite/InMemory error shape)", async () => {
    const { uniqueRejections, ids } = await runMultiProcessRace({
      errorShape: "sqlite",
      key: "crd",
    });
    expect(ids.size).toBe(1);
    expect(uniqueRejections).toBeGreaterThanOrEqual(1);
  });

  it("twin resolver instances racing the same CRD collapse to one row (Postgres error shape)", async () => {
    const { uniqueRejections, ids } = await runMultiProcessRace({
      errorShape: "pg",
      key: "crd",
    });
    expect(ids.size).toBe(1);
    expect(uniqueRejections).toBeGreaterThanOrEqual(1);
  });

  // No name-race counterpart: the (resolver_version, normalized_name) tuple
  // is intentionally NOT a storage-level UNIQUE constraint because two
  // distinct CIKs can legitimately share a normalized name. The in-process
  // AsyncMutex is the only collapse mechanism for name-only resolution.
});
