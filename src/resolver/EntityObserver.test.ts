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
  CanonicalPersonAliasPrimaryKeyNames,
  CanonicalPersonAliasSchema,
  type CanonicalCompanyAlias,
  type CanonicalPersonAlias,
} from "../storage/canonical/CanonicalAliasSchemas";
import { CanonicalCompanyAliasRepo } from "../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalCompanyRepo } from "../storage/canonical/CanonicalCompanyRepo";
import {
  CanonicalCompanyPrimaryKeyNames,
  CanonicalCompanySchema,
  type CanonicalCompany,
} from "../storage/canonical/CanonicalCompanySchema";
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
import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import {
  CompanyIdentityLinkPrimaryKeyNames,
  CompanyIdentityLinkSchema,
  type CompanyIdentityLink,
} from "../storage/canonical/CompanyIdentityLinkSchema";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import {
  PersonIdentityLinkPrimaryKeyNames,
  PersonIdentityLinkSchema,
  type PersonIdentityLink,
} from "../storage/canonical/PersonIdentityLinkSchema";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import {
  CompanyObservationPrimaryKeyNames,
  CompanyObservationSchema,
  type CompanyObservation,
} from "../storage/observation/CompanyObservationSchema";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import {
  PersonObservationPrimaryKeyNames,
  PersonObservationSchema,
  type PersonObservation,
} from "../storage/observation/PersonObservationSchema";
import { CompanyResolver } from "./CompanyResolver";
import type { CompanyClaim, PersonClaim } from "./EntityObserver";
import { EntityObserver } from "./EntityObserver";
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
  const aliasRepo = new CanonicalPersonAliasRepo({ canonicalPersonAliasRepository: aliasStorage });
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
    canonRepo,
    aliasRepo,
    identityLinkRepo,
    addressRepo,
    addressJunctionStorage,
    resolver,
  };
}

function makeCompanyRepos() {
  const companyObsStorage = new InMemoryTabularStorage<
    typeof CompanyObservationSchema,
    typeof CompanyObservationPrimaryKeyNames,
    CompanyObservation
  >(CompanyObservationSchema, CompanyObservationPrimaryKeyNames, [
    ["accession_number", "extractor_id", "observation_index"],
  ]);
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
  const identityLinkStorage = new InMemoryTabularStorage<
    typeof CompanyIdentityLinkSchema,
    typeof CompanyIdentityLinkPrimaryKeyNames,
    CompanyIdentityLink
  >(CompanyIdentityLinkSchema, CompanyIdentityLinkPrimaryKeyNames, []);

  const companyObsRepo = new CompanyObservationRepo({
    companyObservationRepository: companyObsStorage,
  });
  const canonRepo = new CanonicalCompanyRepo({ canonicalCompanyRepository: canonStorage });
  const aliasRepo = new CanonicalCompanyAliasRepo({
    canonicalCompanyAliasRepository: aliasStorage,
  });
  const identityLinkRepo = new CompanyIdentityLinkRepo({
    companyIdentityLinkRepository: identityLinkStorage,
  });
  const resolver = new CompanyResolver({
    canonicalCompanyRepo: canonRepo,
    canonicalCompanyAliasRepo: aliasRepo,
    activeResolverVersion: "1.0.0",
  });

  return { companyObsRepo, canonRepo, identityLinkRepo, resolver };
}

describe("EntityObserver.observePerson", () => {
  let personSetup: ReturnType<typeof makePersonRepos>;
  let observer: EntityObserver;

  beforeEach(() => {
    personSetup = makePersonRepos();
    observer = new EntityObserver({
      personObservationRepo: personSetup.personObsRepo,
      companyObservationRepo: undefined as any,
      personIdentityLinkRepo: personSetup.identityLinkRepo,
      companyIdentityLinkRepo: undefined as any,
      personResolver: personSetup.resolver,
      companyResolver: undefined as any,
      canonicalPersonAddressRepo: personSetup.addressRepo,
      canonicalPersonPhoneRepo: undefined as any,
      canonicalCompanyAddressRepo: undefined as any,
      canonicalCompanyPhoneRepo: undefined as any,
      activeResolverPersonVersion: "1.0.0",
      activeResolverCompanyVersion: "1.0.0",
    });
  });

  it("writes observation, resolves canonical, writes identity link, increments address junction", async () => {
    const claim: PersonClaim = {
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 1234,
      first_name: "Jane",
      last_name: "Smith",
      address_id: "addr-hash-abc123",
    };

    const result = await observer.observePerson(claim);

    expect(result.canonical_person_id).toBeTypeOf("string");
    expect(result.observation_id).toBeGreaterThan(0);

    // identity link was written
    const link = await personSetup.identityLinkRepo.getForObservation(
      result.observation_id,
      "1.0.0"
    );
    expect(link).toBeDefined();
    expect(link?.canonical_person_id).toBe(result.canonical_person_id);

    // address junction was incremented
    const addresses = await personSetup.addressRepo.listForCanonical(
      result.canonical_person_id,
      "1.0.0"
    );
    expect(addresses).toHaveLength(1);
    expect(addresses[0].address_hash_id).toBe("addr-hash-abc123");
    expect(addresses[0].observation_count).toBe(1);
  });

  it("idempotent: same natural key yields same observation_id and canonical_person_id", async () => {
    const claim: PersonClaim = {
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 5678,
      first_name: "Bob",
      last_name: "Jones",
    };

    const first = await observer.observePerson(claim);
    const second = await observer.observePerson(claim);

    expect(second.observation_id).toBe(first.observation_id);
    expect(second.canonical_person_id).toBe(first.canonical_person_id);
  });
});

describe("EntityObserver.observeCompany", () => {
  let companySetup: ReturnType<typeof makeCompanyRepos>;
  let observer: EntityObserver;

  beforeEach(() => {
    companySetup = makeCompanyRepos();
    observer = new EntityObserver({
      personObservationRepo: undefined as any,
      companyObservationRepo: companySetup.companyObsRepo,
      personIdentityLinkRepo: undefined as any,
      companyIdentityLinkRepo: companySetup.identityLinkRepo,
      personResolver: undefined as any,
      companyResolver: companySetup.resolver,
      canonicalPersonAddressRepo: undefined as any,
      canonicalPersonPhoneRepo: undefined as any,
      canonicalCompanyAddressRepo: undefined as any,
      canonicalCompanyPhoneRepo: undefined as any,
      activeResolverPersonVersion: "1.0.0",
      activeResolverCompanyVersion: "1.0.0",
    });
  });

  it("writes observation, resolves canonical, writes identity link", async () => {
    const claim: CompanyClaim = {
      accession_number: "0001-25-000002",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 9999,
      name: "Acme Corporation LLC",
    };

    const result = await observer.observeCompany(claim);

    expect(result.canonical_company_id).toBeTypeOf("string");
    expect(result.observation_id).toBeGreaterThan(0);

    // identity link was written
    const link = await companySetup.identityLinkRepo.getForObservation(
      result.observation_id,
      "1.0.0"
    );
    expect(link).toBeDefined();
    expect(link?.canonical_company_id).toBe(result.canonical_company_id);
  });
});
