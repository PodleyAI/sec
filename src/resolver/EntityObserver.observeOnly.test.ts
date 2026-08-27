/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import {
  CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN,
  CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
  CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN,
} from "../storage/canonical/CanonicalJunctionSchemas";
import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { PersonRoleRepo } from "../storage/canonical/PersonRoleRepo";
import { RoleRosterCompletenessRepo } from "../storage/canonical/RoleRosterCompletenessRepo";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { PersonObservationTitleRepo } from "../storage/observation/PersonObservationTitleRepo";
import { buildEntityObserver } from "./buildEntityObserver";
import type { CompanyClaim, PersonClaim } from "./EntityObserver";
import { EntityObserver } from "./EntityObserver";
import { COMPLETE_ROSTER_ROLE_SCOPES } from "./roleScopes";

const RESOLVER_VERSION = "1.0.0";

/** An observer given the observation repos and nothing else. */
function observeOnlyObserver(): EntityObserver<{
  personObservationRepo: PersonObservationRepo;
  personObservationTitleRepo: PersonObservationTitleRepo;
  companyObservationRepo: CompanyObservationRepo;
}> {
  return new EntityObserver({
    personObservationRepo: new PersonObservationRepo(),
    personObservationTitleRepo: new PersonObservationTitleRepo(),
    companyObservationRepo: new CompanyObservationRepo(),
  });
}

/**
 * A claim carrying everything the resolver tier feeds on: an address and a
 * phone to count, and the date/scope/issuer triple a tenure needs.
 */
const PERSON_CLAIM: PersonClaim = {
  accession_number: "0000000000-26-000001",
  extractor_id: "D",
  extractor_version: "1.0.0",
  observation_index: 0,
  source_filing_issuer_cik: 9000,
  cik: 2001,
  first_name: "Jane",
  last_name: "Smith",
  titles: ["Chief Executive Officer", "Director"],
  role_scope: COMPLETE_ROSTER_ROLE_SCOPES.formDRelatedPerson,
  filing_date: "2026-01-15",
  address_id: "addr-hash-abc123",
  international_number: "+1-555-0001",
};

const COMPANY_CLAIM: CompanyClaim = {
  accession_number: "0000000000-26-000001",
  extractor_id: "D",
  extractor_version: "1.0.0",
  observation_index: 0,
  cik: 9000,
  name: "Blue Acquisition Corp",
  address_id: "addr-hash-abc123",
};

describe("EntityObserver without a resolver tier", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("records the person observation and its titles, and nothing in the canonical tier", async () => {
    const result = await observeOnlyObserver().observePerson(PERSON_CLAIM);

    expect(result.observation_id).toBeGreaterThan(0);
    // No canonical id to return, and none invented: the observation id is the
    // whole result.
    expect(Object.keys(result)).toEqual(["observation_id"]);

    const observation = await new PersonObservationRepo().getById(result.observation_id);
    expect(observation?.accession_number).toBe(PERSON_CLAIM.accession_number);
    expect(observation?.normalized_last).toBe("Smith");
    expect(observation?.raw_address_id).toBe("addr-hash-abc123");

    expect(
      await new PersonObservationTitleRepo().listForObservation(result.observation_id)
    ).toEqual(["Chief Executive Officer", "Director"]);

    expect(
      await new PersonIdentityLinkRepo().getForObservation(result.observation_id, RESOLVER_VERSION)
    ).toBeUndefined();
    expect(await new PersonIdentityLinkRepo().count()).toBe(0);
    expect(
      (await globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN).getAll()) ?? []
    ).toHaveLength(0);
    expect(
      (await globalServiceRegistry.get(CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN).getAll()) ?? []
    ).toHaveLength(0);
    expect(await new PersonRoleRepo().count()).toBe(0);
  });

  it("records the company observation, and no link or junction row", async () => {
    const result = await observeOnlyObserver().observeCompany(COMPANY_CLAIM);

    expect(result.observation_id).toBeGreaterThan(0);
    expect(Object.keys(result)).toEqual(["observation_id"]);

    const observation = await new CompanyObservationRepo().getById(result.observation_id);
    expect(observation?.normalized_name).toBe("Blue Acquisition");

    expect(await new CompanyIdentityLinkRepo().count()).toBe(0);
    expect(
      (await globalServiceRegistry.get(CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN).getAll()) ?? []
    ).toHaveLength(0);
  });

  it("still records the roster completeness decision a later rebuild closes from", async () => {
    const observer = observeOnlyObserver();
    await observer.observePerson(PERSON_CLAIM);
    const closed = await observer.closeUnassertedPersonRoles({
      accession_number: PERSON_CLAIM.accession_number,
      extractor_id: "D",
      role_scope: COMPLETE_ROSTER_ROLE_SCOPES.formDRelatedPerson,
      company_cik: 9000,
      filing_date: "2026-01-15",
    });

    // Nothing to close without tenures to close, but the decision is on disk.
    expect(closed).toBe(0);
    const decisions = await new RoleRosterCompletenessRepo().listForAccessions([
      PERSON_CLAIM.accession_number,
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].complete).toBe(true);
  });

  it("is the same claim a resolving observer links, counts and dates a tenure from", async () => {
    // The contrast that keeps the assertions above from passing on a claim the
    // resolver tier would have ignored anyway.
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    const person = await observer.observePerson(PERSON_CLAIM);
    await observer.observeCompany(COMPANY_CLAIM);

    expect(
      await new PersonIdentityLinkRepo().getForObservation(person.observation_id, RESOLVER_VERSION)
    ).toBeDefined();
    expect(await new CompanyIdentityLinkRepo().count()).toBe(1);
    expect(
      (await globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN).getAll()) ?? []
    ).toHaveLength(1);
    expect(
      (await globalServiceRegistry.get(CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN).getAll()) ?? []
    ).toHaveLength(1);
    expect(
      (await globalServiceRegistry.get(CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN).getAll()) ?? []
    ).toHaveLength(1);
    expect(await new PersonRoleRepo().count()).toBe(2);
  });
});
