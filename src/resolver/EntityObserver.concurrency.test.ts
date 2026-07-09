/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import {
  CanonicalPersonAliasPrimaryKeyNames,
  CanonicalPersonAliasSchema,
  type CanonicalPersonAlias,
} from "../storage/canonical/CanonicalAliasSchemas";
import {
  CanonicalPersonAddressPrimaryKeyNames,
  CanonicalPersonAddressSchema,
  type CanonicalPersonAddress,
} from "../storage/canonical/CanonicalJunctionSchemas";
import { CanonicalPersonAddressRepo } from "../storage/canonical/CanonicalPersonAddressRepo";
import { CanonicalPersonAliasRepo } from "../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalPersonRepo } from "../storage/canonical/CanonicalPersonRepo";
import {
  CanonicalPersonPrimaryKeyNames,
  CanonicalPersonSchema,
  type CanonicalPerson,
} from "../storage/canonical/CanonicalPersonSchema";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import {
  PersonIdentityLinkPrimaryKeyNames,
  PersonIdentityLinkSchema,
  type PersonIdentityLink,
} from "../storage/canonical/PersonIdentityLinkSchema";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import {
  PersonObservationPrimaryKeyNames,
  PersonObservationSchema,
  type PersonObservation,
} from "../storage/observation/PersonObservationSchema";
import { EntityObserver, type PersonClaim } from "./EntityObserver";
import { PersonResolver } from "./PersonResolver";

function makePersonRepos() {
  const personObsStorage = new InMemoryTabularStorage<
    typeof PersonObservationSchema,
    typeof PersonObservationPrimaryKeyNames,
    PersonObservation
  >(PersonObservationSchema, PersonObservationPrimaryKeyNames, [
    ["accession_number", "extractor_id", "observation_index"],
  ]);
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
  const identityLinkStorage = new InMemoryTabularStorage<
    typeof PersonIdentityLinkSchema,
    typeof PersonIdentityLinkPrimaryKeyNames,
    PersonIdentityLink
  >(PersonIdentityLinkSchema, PersonIdentityLinkPrimaryKeyNames, []);
  const addressJunctionStorage = new InMemoryTabularStorage<
    typeof CanonicalPersonAddressSchema,
    typeof CanonicalPersonAddressPrimaryKeyNames,
    CanonicalPersonAddress
  >(CanonicalPersonAddressSchema, CanonicalPersonAddressPrimaryKeyNames, []);

  const personObsRepo = new PersonObservationRepo({
    personObservationRepository: personObsStorage,
  });
  const canonRepo = new CanonicalPersonRepo({ canonicalPersonRepository: canonStorage });
  const aliasRepo = new CanonicalPersonAliasRepo({
    canonicalPersonAliasRepository: aliasStorage,
  });
  const identityLinkRepo = new PersonIdentityLinkRepo({
    personIdentityLinkRepository: identityLinkStorage,
  });
  const addressRepo = new CanonicalPersonAddressRepo({
    canonicalPersonAddressRepository: addressJunctionStorage,
  });
  const resolver = new PersonResolver({
    canonicalPersonRepo: canonRepo,
    canonicalPersonAliasRepo: aliasRepo,
    activeResolverVersion: "1.0.0",
  });

  return {
    personObsRepo,
    identityLinkRepo,
    addressRepo,
    addressJunctionStorage,
    resolver,
  };
}

describe("EntityObserver concurrency", () => {
  let setup: ReturnType<typeof makePersonRepos>;
  let observer: EntityObserver;

  beforeEach(() => {
    setup = makePersonRepos();
    observer = new EntityObserver({
      personObservationRepo: setup.personObsRepo,
      companyObservationRepo: undefined as any,
      personIdentityLinkRepo: setup.identityLinkRepo,
      companyIdentityLinkRepo: undefined as any,
      personResolver: setup.resolver,
      companyResolver: undefined as any,
      canonicalPersonAddressRepo: setup.addressRepo,
      canonicalPersonPhoneRepo: undefined as any,
      canonicalCompanyAddressRepo: undefined as any,
      canonicalCompanyPhoneRepo: undefined as any,
      activeResolverPersonVersion: "1.0.0",
      activeResolverCompanyVersion: "1.0.0",
    });
  });

  it("two concurrent observePerson calls for the same canonical + same address produce observation_count === 2", async () => {
    // Two claims for the same CIK -> same canonical person, at distinct
    // observation indices (distinct observation rows) but the same address.
    const base: Omit<PersonClaim, "observation_index"> = {
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      cik: 1234,
      first_name: "Jane",
      last_name: "Smith",
      address_id: "addr-hash-abc123",
    };
    const [a, b] = await Promise.all([
      observer.observePerson({ ...base, observation_index: 0 }),
      observer.observePerson({ ...base, observation_index: 1 }),
    ]);
    expect(a.canonical_person_id).toBe(b.canonical_person_id);

    const addresses = await setup.addressRepo.listForCanonical(a.canonical_person_id, "1.0.0");
    expect(addresses).toHaveLength(1);
    expect(addresses[0].observation_count).toBe(2);
  });
});
