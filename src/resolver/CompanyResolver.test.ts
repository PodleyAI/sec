/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import {
  CanonicalCompanyAliasPrimaryKeyNames,
  CanonicalCompanyAliasSchema,
  type CanonicalCompanyAlias,
} from "../storage/canonical/CanonicalAliasSchemas";
import { CanonicalCompanyAliasRepo } from "../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalCompanyRepo } from "../storage/canonical/CanonicalCompanyRepo";
import {
  CanonicalCompanyPrimaryKeyNames,
  CanonicalCompanySchema,
  type CanonicalCompany,
} from "../storage/canonical/CanonicalCompanySchema";
import type { CompanyObservation } from "../storage/observation/CompanyObservationSchema";
import { CompanyResolver } from "./CompanyResolver";

function makeRepos() {
  const canonStorage = new InMemoryTabularStorage<
    typeof CanonicalCompanySchema,
    typeof CanonicalCompanyPrimaryKeyNames,
    CanonicalCompany
  >(CanonicalCompanySchema, CanonicalCompanyPrimaryKeyNames, [
    ["resolver_version", "cik"],
    ["resolver_version", "crd_number"],
    ["resolver_version", "normalized_name"],
  ]);
  const aliasStorage = new InMemoryTabularStorage<
    typeof CanonicalCompanyAliasSchema,
    typeof CanonicalCompanyAliasPrimaryKeyNames,
    CanonicalCompanyAlias
  >(CanonicalCompanyAliasSchema, CanonicalCompanyAliasPrimaryKeyNames, []);
  return {
    canonRepo: new CanonicalCompanyRepo({ canonicalCompanyRepository: canonStorage }),
    aliasRepo: new CanonicalCompanyAliasRepo({ canonicalCompanyAliasRepository: aliasStorage }),
    canonStorage,
    aliasStorage,
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

describe("CompanyResolver.resolve", () => {
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

  it("C1: CIK present → same canonical per CIK at the resolver version", async () => {
    const a = await resolver.resolve(obs({ cik: 1234 }));
    const b = await resolver.resolve(obs({ cik: 1234, observation_id: 2 }));
    expect(a).toBe(b);
  });

  it("C1: different CIKs → different canonicals", async () => {
    const a = await resolver.resolve(obs({ cik: 1234 }));
    const b = await resolver.resolve(obs({ cik: 5678, observation_id: 2 }));
    expect(a).not.toBe(b);
  });

  it("C2: no CIK but CRD present → keyed on CRD", async () => {
    const a = await resolver.resolve(obs({ crd_number: "12345" }));
    const b = await resolver.resolve(obs({ crd_number: "12345", observation_id: 2 }));
    expect(a).toBe(b);
  });

  it("C2: different CRDs → different canonicals", async () => {
    const a = await resolver.resolve(obs({ crd_number: "12345" }));
    const b = await resolver.resolve(obs({ crd_number: "99999", observation_id: 2 }));
    expect(a).not.toBe(b);
  });

  it("C3: no CIK, no CRD, name present → keyed on normalized_name (no issuer scoping)", async () => {
    const a = await resolver.resolve(obs({ normalized_name: "acme corp" }));
    const b = await resolver.resolve(obs({ normalized_name: "acme corp", observation_id: 2 }));
    expect(a).toBe(b);
  });

  it("C3: different names → different canonicals", async () => {
    const a = await resolver.resolve(obs({ normalized_name: "acme corp" }));
    const b = await resolver.resolve(obs({ normalized_name: "globex corp", observation_id: 2 }));
    expect(a).not.toBe(b);
  });

  it("C4: throws when none of CIK/CRD/name present", async () => {
    await expect(resolver.resolve(obs({}))).rejects.toThrow();
  });

  it("CIK takes priority over CRD", async () => {
    const a = await resolver.resolve(obs({ cik: 1234, crd_number: "12345" }));
    const b = await resolver.resolve(obs({ cik: 1234, observation_id: 2 }));
    expect(a).toBe(b);
  });

  it("CRD takes priority over name", async () => {
    const a = await resolver.resolve(obs({ crd_number: "12345", normalized_name: "acme corp" }));
    const b = await resolver.resolve(obs({ crd_number: "12345", observation_id: 2 }));
    expect(a).toBe(b);
  });

  it("applies alias final pass", async () => {
    const candidate = await resolver.resolve(obs({ cik: 1234 }));
    const targetRow: CanonicalCompany = {
      canonical_company_id: "alias-target",
      resolver_version: "1.0.0",
      display_name: null,
      cik: null,
      crd_number: null,
      normalized_name: null,
      created_at: "2026-05-22T00:00:00.000Z",
    };
    await setup.canonRepo.create(targetRow);
    await setup.aliasRepo.add(candidate, "alias-target", "test merge", "test");
    const result = await resolver.resolve(obs({ cik: 1234, observation_id: 3 }));
    expect(result).toBe("alias-target");
  });

  it("serialises alias lookup inside the per-key mutex (no overlapping alias.resolve calls)", async () => {
    // The previous regression test stubbed `aliasRepo.resolve` to always
    // return a constant id regardless of input, so both pre-fix (lookup
    // outside the mutex) and post-fix (lookup inside the mutex) code paths
    // produced the same final answer and the test could not discriminate the
    // bug. The actual difference between the two code paths is whether the
    // alias lookups overlap in time — pre-fix runs them in parallel after
    // the mutex releases; post-fix runs them sequentially inside the lock.
    //
    // Track concurrent in-flight alias.resolve calls. Pre-fix code drives the
    // counter to 2 simultaneously when two resolves run in parallel; post-fix
    // never sees more than one in flight.

    const originalCreate = setup.canonRepo.create.bind(setup.canonRepo);
    let createCount = 0;
    setup.canonRepo.create = (async (row: CanonicalCompany) => {
      createCount += 1;
      return originalCreate(row);
    }) as typeof setup.canonRepo.create;

    let inFlight = 0;
    let maxInFlight = 0;
    let aliasCallCount = 0;
    setup.aliasRepo.resolve = async (id: string) => {
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
      resolver.resolve(obs({ cik: 4242 })),
      resolver.resolve(obs({ cik: 4242, observation_id: 2 })),
    ]);

    // Post-fix: alias lookup is inside the mutex → at most one in flight.
    // Pre-fix: alias lookup is after mutex.release → both run in parallel.
    expect(maxInFlight).toBe(1);
    expect(aliasCallCount).toBe(2);
    // Exactly one canonical row was minted — find-or-create remains serialised.
    expect(createCount).toBe(1);
  });
});
