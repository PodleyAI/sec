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
import { normalizePerson } from "../storage/person/PersonNormalization";
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

/**
 * `personKey` matches on the observation's STORED `normalized_*` columns, so a
 * change to what `normalizePerson` writes into them re-partitions identity at
 * whatever `resolver_version` happens to be active. These observations are
 * therefore built the way `EntityObserver` builds them — from a display name
 * through `normalizePerson` — rather than with hand-written normalized values,
 * which would pin the resolver while leaving the hazard invisible.
 */
describe("PersonResolver identity is keyed off normalizePerson's output", () => {
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

  function observed(name: string, observation_id: number): PersonObservation {
    const n = normalizePerson({ name });
    return obs({
      observation_id,
      cik: null,
      source_filing_issuer_cik: 100,
      first_name: n?.first ?? null,
      middle_name: n?.middle ?? null,
      last_name: n?.last ?? null,
      suffix: n?.suffix ?? null,
      normalized_first: n?.first ?? null,
      normalized_middle: n?.middle ?? null,
      normalized_last: n?.last ?? null,
      normalized_suffix: n?.suffix ?? null,
    });
  }

  it("resolves a parenthesized nickname and the bare name to ONE canonical person", async () => {
    const withNickname = await resolver.resolve(observed("Yong (David) Yan", 1));
    const bare = await resolver.resolve(observed("Yong Yan", 2));

    const rows = await setup.canonStorage.getAll();
    expect(
      withNickname,
      "A parenthesized nickname reached `normalized_middle`, so the same person " +
        "no longer matches the canonical row written from the bare spelling. " +
        "`normalized_middle` is a member of `PersonResolver.personKey`: moving a " +
        "name part into it re-keys every `canonical_person` row already written " +
        "at the active resolver_version, and the next filing naming that person " +
        "mints a SECOND row at the SAME version. Bump the `person` resolver " +
        "(sec version start-dev resolver person <next> --bump major), re-extract " +
        "and re-resolve at the new version, then land the change."
    ).toBe(bare);
    expect(rows).toHaveLength(1);
  });

  it("still splits people who differ in a real middle name", async () => {
    const noMiddle = await resolver.resolve(observed("Yong Yan", 1));
    const withMiddle = await resolver.resolve(observed("Yong David Yan", 2));
    expect(withMiddle).not.toBe(noMiddle);
    expect(await setup.canonStorage.getAll()).toHaveLength(2);
  });

  it("keeps a credential in the key — 'Jane Doe, CPA' is its own canonical row", async () => {
    const credentialed = await resolver.resolve(observed("Jane Doe, CPA", 1));
    const bare = await resolver.resolve(observed("Jane Doe", 2));

    // The over-split the credential rule causes, pinned as-is. Narrowing
    // `normalized_suffix` to the generational half alone fixes it and is worth
    // doing — behind a `person` resolver version bump, because the canonical
    // rows already carrying "Cpa" would otherwise stop matching silently.
    expect(credentialed).not.toBe(bare);
    expect(await setup.canonStorage.getAll()).toHaveLength(2);
  });
});
