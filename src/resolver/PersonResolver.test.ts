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
    // Mirrors `storageRegistry.ts`: a plain index on the name lookup, and
    // UNIQUE on (resolver_version, cik) ONLY — a name tuple is legitimately
    // shared, so the double must not enforce a constraint the real backends
    // do not have. `uniqueIndexes` is the 7th constructor argument, hence the
    // defaulted positionals in between.
  >(
    CanonicalPersonSchema,
    CanonicalPersonPrimaryKeyNames,
    [["resolver_version", "normalized_last"]],
    "if-missing",
    undefined,
    "inmemory",
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

  it("merges compatible variants within one filing and selects the best display", async () => {
    const common = {
      accession_number: "same-filing",
      source_filing_issuer_cik: 100,
      relationship: "form-c:signature",
    };
    const abbreviated = obs({
      ...common,
      first_name: "Sam",
      middle_name: "A",
      last_name: "Dowling",
      normalized_first: "Sam",
      normalized_middle: "A",
      normalized_last: "Dowling",
    });
    const misspelled = obs({
      ...common,
      observation_id: 2,
      first_name: "Samual",
      last_name: "Dowling",
      normalized_first: "Samual",
      normalized_last: "Dowling",
    });
    const complete = obs({
      ...common,
      observation_id: 3,
      first_name: "Sam",
      middle_name: "Alan",
      last_name: "Dowling",
      normalized_first: "Sam",
      normalized_middle: "Alan",
      normalized_last: "Dowling",
    });

    const ids = await Promise.all([
      resolver.resolve(abbreviated),
      resolver.resolve(misspelled),
      resolver.resolve(complete),
    ]);
    expect(new Set(ids).size).toBe(1);
    expect(await setup.canonRepo.getById(ids[0])).toMatchObject({
      display_first: "Sam",
      display_middle: "Alan",
      display_last: "Dowling",
    });
  });

  it("does not merge incompatible middle names in one filing", async () => {
    const a = await resolver.resolve(
      obs({
        accession_number: "same-filing",
        first_name: "Sam",
        middle_name: "Alan",
        last_name: "Dowling",
        normalized_first: "Sam",
        normalized_middle: "Alan",
        normalized_last: "Dowling",
      })
    );
    const b = await resolver.resolve(
      obs({
        accession_number: "same-filing",
        observation_id: 2,
        first_name: "Sam",
        middle_name: "Brian",
        last_name: "Dowling",
        normalized_first: "Sam",
        normalized_middle: "Brian",
        normalized_last: "Dowling",
      })
    );
    expect(a).not.toBe(b);
  });

  it("does not merge a generational suffix with its unsuffixed namesake in one filing", async () => {
    const senior = await resolver.resolve(
      obs({
        accession_number: "same-filing",
        first_name: "Nora",
        last_name: "Nocik",
        normalized_first: "Nora",
        normalized_last: "Nocik",
      })
    );
    const junior = await resolver.resolve(
      obs({
        accession_number: "same-filing",
        observation_id: 2,
        first_name: "Nora",
        last_name: "Nocik",
        suffix: "Jr.",
        normalized_first: "Nora",
        normalized_last: "Nocik",
        normalized_suffix: "Jr",
      })
    );
    expect(senior).not.toBe(junior);
  });

  it("scores a middle name present on one side no lower than one absent from both", async () => {
    // "Rob"/"Robert" merges when neither carries a middle name, so it must
    // also merge when one of them does — more information about one side
    // cannot make the pair less likely to be the same person.
    const withMiddle = await resolver.resolve(
      obs({
        accession_number: "same-filing",
        first_name: "Rob",
        middle_name: "A",
        last_name: "Renner",
        normalized_first: "Rob",
        normalized_middle: "A",
        normalized_last: "Renner",
      })
    );
    const withoutMiddle = await resolver.resolve(
      obs({
        accession_number: "same-filing",
        observation_id: 2,
        first_name: "Robert",
        last_name: "Renner",
        normalized_first: "Robert",
        normalized_last: "Renner",
      })
    );
    expect(withoutMiddle).toBe(withMiddle);
  });

  it("mints its own canonical when two in-filing candidates match equally well", async () => {
    // Two Chris Bells the filing distinguishes by middle name, then a third
    // observation compatible with BOTH. Nothing breaks the tie, so guessing
    // either would be a coin flip recorded as an identity.
    const withA = await resolver.resolve(
      obs({
        accession_number: "same-filing",
        relationship: "form-c:signature",
        first_name: "Chris",
        middle_name: "A",
        last_name: "Bell",
        normalized_first: "Chris",
        normalized_middle: "A",
        normalized_last: "Bell",
      })
    );
    const withB = await resolver.resolve(
      obs({
        accession_number: "same-filing",
        observation_id: 2,
        relationship: "form-c:signature",
        first_name: "Chris",
        middle_name: "B",
        last_name: "Bell",
        normalized_first: "Chris",
        normalized_middle: "B",
        normalized_last: "Bell",
      })
    );
    const ambiguous = await resolver.resolve(
      obs({
        accession_number: "same-filing",
        observation_id: 3,
        relationship: "form-c:signature",
        first_name: "Chris",
        last_name: "Bell",
        normalized_first: "Chris",
        normalized_last: "Bell",
      })
    );
    expect(withA).not.toBe(withB);
    expect(ambiguous).not.toBe(withA);
    expect(ambiguous).not.toBe(withB);
  });

  it("upgrades the display of the surviving canonical, not the retired alias", async () => {
    const retired = await resolver.resolve(
      obs({ cik: 4242, first_name: "Dana", last_name: "Dual" })
    );
    const survivor = await resolver.resolve(
      obs({ observation_id: 2, cik: 4343, first_name: "Dana", last_name: "Dual" })
    );
    await setup.aliasRepo.add(retired, survivor, "merged duplicate", "test");

    // A replay of the retired identity carrying a fuller name. It resolves
    // THROUGH the alias, so the better name belongs on the survivor.
    await resolver.resolve(
      obs({
        observation_id: 3,
        cik: 4242,
        first_name: "Dana",
        middle_name: "Quinn",
        last_name: "Dual",
      })
    );

    expect(await setup.canonRepo.getById(survivor)).toMatchObject({ display_middle: "Quinn" });
    expect(await setup.canonRepo.getById(retired)).toMatchObject({ display_middle: null });
  });

  it("adopts an existing name-keyed row instead of overwriting it", async () => {
    // The name-keyed id is deterministic, so a writer in another process
    // leaves a row under exactly the id this resolver would mint. `create` is
    // an upsert, so without an adopt-if-present read the second writer would
    // reset `created_at` and discard the display name already chosen.
    const first = await resolver.resolve(
      obs({
        first_name: "Ida",
        middle_name: "Beatrix",
        last_name: "Prior",
        normalized_first: "Ida",
        normalized_middle: "Beatrix",
        normalized_last: "Prior",
      })
    );
    const existing = await setup.canonRepo.getById(first);

    // A second resolver instance, as another process would have: no shared
    // mutex map and no same-filing cache, reaching the same identity key.
    const other = new PersonResolver({
      canonicalPersonRepo: setup.canonRepo,
      canonicalPersonAliasRepo: setup.aliasRepo,
      activeResolverVersion: "1.0.0",
    });
    const second = await other.resolve(
      obs({
        observation_id: 2,
        accession_number: "other-filing",
        first_name: "Ida",
        last_name: "Prior",
        normalized_first: "Ida",
        normalized_middle: "Beatrix",
        normalized_last: "Prior",
      })
    );

    expect(second).toBe(first);
    const after = await setup.canonRepo.getById(first);
    expect(after?.created_at).toBe(existing?.created_at);
    expect(after?.display_middle).toBe("Beatrix");
  });

  it("cleans legacy full-signature observations before creating canonical display", async () => {
    const id = await resolver.resolve(
      obs({
        last_name: "/s/ Charles A. Ross, Jr.",
        suffix: "Jr",
        normalized_first: "Charles",
        normalized_middle: "A",
        normalized_last: "Ross",
        normalized_suffix: "Jr",
      })
    );
    expect(await setup.canonRepo.getById(id)).toMatchObject({
      display_first: "Charles",
      display_middle: "A.",
      display_last: "Ross",
      display_suffix: "Jr.",
    });
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
