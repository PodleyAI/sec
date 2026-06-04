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
