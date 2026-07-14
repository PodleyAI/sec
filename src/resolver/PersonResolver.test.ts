/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import {
  CanonicalPersonAliasPrimaryKeyNames,
  CanonicalPersonAliasSchema,
  type CanonicalPersonAlias,
} from "../storage/canonical/CanonicalAliasSchemas";
import { CanonicalPersonAliasRepo } from "../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalPersonRepo } from "../storage/canonical/CanonicalPersonRepo";
import {
  CanonicalPersonPrimaryKeyNames,
  CanonicalPersonSchema,
  type CanonicalPerson,
} from "../storage/canonical/CanonicalPersonSchema";
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
    aliasRepo: new CanonicalPersonAliasRepo({ canonicalPersonAliasRepository: aliasStorage }),
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
    titles: null,
    relationship: null,
    raw_address_id: null,
    raw_phone_id: null,
    source_context: null,
    created_at: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("PersonResolver.resolve", () => {
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

  it("P1: CIK present → same canonical per CIK at the resolver version", async () => {
    const a = await resolver.resolve(obs({ cik: 1234 }));
    const b = await resolver.resolve(obs({ cik: 1234, observation_id: 2 }));
    expect(a).toBe(b);
  });

  it("P1: different CIKs → different canonicals", async () => {
    const a = await resolver.resolve(obs({ cik: 1234 }));
    const b = await resolver.resolve(obs({ cik: 5678, observation_id: 2 }));
    expect(a).not.toBe(b);
  });

  it("P2: no CIK → keyed on normalized name + issuer", async () => {
    const a = await resolver.resolve(
      obs({ normalized_first: "jane", normalized_last: "smith", source_filing_issuer_cik: 100 })
    );
    const b = await resolver.resolve(
      obs({
        normalized_first: "jane",
        normalized_last: "smith",
        source_filing_issuer_cik: 100,
        observation_id: 2,
      })
    );
    expect(a).toBe(b);
  });

  it("P2: same name, different issuer_cik → split (D17a)", async () => {
    const a = await resolver.resolve(
      obs({ normalized_first: "jane", normalized_last: "smith", source_filing_issuer_cik: 100 })
    );
    const b = await resolver.resolve(
      obs({
        normalized_first: "jane",
        normalized_last: "smith",
        source_filing_issuer_cik: 200,
        observation_id: 2,
      })
    );
    expect(a).not.toBe(b);
  });

  it("CIK observation and no-CIK observation with same name stay split (D17b)", async () => {
    const a = await resolver.resolve(obs({ cik: 1234 }));
    const b = await resolver.resolve(
      obs({
        normalized_first: "jane",
        normalized_last: "smith",
        source_filing_issuer_cik: 100,
        observation_id: 2,
      })
    );
    expect(a).not.toBe(b);
  });

  it("applies alias final pass", async () => {
    const candidate = await resolver.resolve(obs({ cik: 1234 }));
    const targetRow: CanonicalPerson = {
      canonical_person_id: "alias-target",
      resolver_version: "1.0.0",
      display_first: null,
      display_middle: null,
      display_last: null,
      display_suffix: null,
      cik: null,
      normalized_first: null,
      normalized_middle: null,
      normalized_last: null,
      normalized_suffix: null,
      source_filing_issuer_cik: null,
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
    setup.canonRepo.create = (async (row: CanonicalPerson) => {
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
