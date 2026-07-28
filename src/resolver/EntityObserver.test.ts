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
import { PersonObservationTitleRepo } from "../storage/observation/PersonObservationTitleRepo";
import {
  PersonObservationTitlePrimaryKeyNames,
  PersonObservationTitleSchema,
  type PersonObservationTitle,
} from "../storage/observation/PersonObservationTitleSchema";
import { PersonRoleRepo } from "../storage/canonical/PersonRoleRepo";
import {
  PersonRolePrimaryKeyNames,
  PersonRoleSchema,
  type PersonRole,
} from "../storage/canonical/PersonRoleSchema";
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
  const titleStorage = new InMemoryTabularStorage<
    typeof PersonObservationTitleSchema,
    typeof PersonObservationTitlePrimaryKeyNames,
    PersonObservationTitle
  >(PersonObservationTitleSchema, PersonObservationTitlePrimaryKeyNames, [["observation_id"]]);
  const titleRepo = new PersonObservationTitleRepo({
    personObservationTitleRepository: titleStorage,
  });
  const roleStorage = new InMemoryTabularStorage<
    typeof PersonRoleSchema,
    typeof PersonRolePrimaryKeyNames,
    PersonRole
  >(PersonRoleSchema, PersonRolePrimaryKeyNames, []);
  const roleRepo = new PersonRoleRepo({ personRoleRepository: roleStorage });
  const resolver = new PersonResolver({
    canonicalPersonRepo: canonRepo,
    canonicalPersonAliasRepo: aliasRepo,
    activeResolverVersion: "1.0.0",
  });

  return {
    personObsRepo,
    titleRepo,
    titleStorage,
    canonRepo,
    aliasRepo,
    identityLinkRepo,
    addressRepo,
    addressJunctionStorage,
    roleRepo,
    roleStorage,
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
      personObservationTitleRepo: personSetup.titleRepo,
      companyObservationRepo: undefined as any,
      personIdentityLinkRepo: personSetup.identityLinkRepo,
      companyIdentityLinkRepo: undefined as any,
      personResolver: personSetup.resolver,
      companyResolver: undefined as any,
      canonicalPersonAddressRepo: personSetup.addressRepo,
      canonicalPersonPhoneRepo: undefined as any,
      canonicalCompanyAddressRepo: undefined as any,
      canonicalCompanyPhoneRepo: undefined as any,
      personRoleRepo: personSetup.roleRepo,
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

  it("clamps filer-authored free text to the observation column widths", async () => {
    // Real-world trigger: a bank-as-trustee rptOwnerName spelling out the full
    // trust instrument (> 128 chars) — one overlong value must not reject the
    // whole filing with "value too long for type character varying".
    const longName =
      "1st Source Bank, as trustee of the Irrevocable Living Trust Created by " +
      "Ella L. Morris Designated as Trust No. P-2877 dated August 6, 1960";
    const longRelationship = "other: " + "x".repeat(100);
    const claim: PersonClaim = {
      accession_number: "0001-25-000003",
      extractor_id: "3",
      extractor_version: "1.0.0",
      observation_index: 1,
      last_name: longName,
      relationship: longRelationship,
      titles: ["t".repeat(300)],
    };

    const result = await observer.observePerson(claim);

    const row = await personSetup.personObsRepo.getById(result.observation_id);
    expect(row?.last_name).toBe(longName.slice(0, 128));
    expect(row?.relationship).toBe(longRelationship.slice(0, 64));
    const titles = await personSetup.titleRepo.listForObservation(result.observation_id);
    expect(titles[0]).toBe("t".repeat(256));
    expect(row?.normalized_last!.length).toBeLessThanOrEqual(128);
  });

  it("stores one title row per title and replaces them wholesale on re-observation", async () => {
    const claim: PersonClaim = {
      accession_number: "0001-25-000004",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 2,
      last_name: "Rowe",
      titles: ["Chief Executive Officer", "Director", "chief executive officer", ""],
    };
    const first = await observer.observePerson(claim);
    expect(await personSetup.titleRepo.listForObservation(first.observation_id)).toEqual([
      "Chief Executive Officer",
      "Director",
    ]);

    // Re-observation with a shorter list must not leave the dropped title behind.
    const second = await observer.observePerson({ ...claim, titles: ["Director"] });
    expect(second.observation_id).toBe(first.observation_id);
    expect(await personSetup.titleRepo.listForObservation(first.observation_id)).toEqual([
      "Director",
    ]);
  });

  it("records dated role tenures when filing_date, issuer cik, and role_scope are present", async () => {
    const claim: PersonClaim = {
      accession_number: "0001-25-000005",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 3,
      source_filing_issuer_cik: 777,
      last_name: "Tenure",
      titles: ["Executive Officer"],
      filing_date: "2024-03-01",
      role_scope: "form-d:related-person",
    };
    const { canonical_person_id } = await observer.observePerson(claim);

    const roles = await personSetup.roleRepo.listForPerson(canonical_person_id, "1.0.0");
    expect(roles).toHaveLength(1);
    expect(roles[0].title).toBe("Executive Officer");
    expect(roles[0].company_cik).toBe(777);
    expect(roles[0].start_date).toBe("2024-03-01");
    expect(roles[0].end_date).toBeNull();
  });

  it("closes an open role the roster filing no longer asserts, and never its own assertions", async () => {
    const base: Omit<PersonClaim, "accession_number" | "observation_index" | "filing_date"> = {
      extractor_id: "D",
      extractor_version: "1.0.0",
      source_filing_issuer_cik: 777,
      role_scope: "form-d:related-person",
      last_name: "Boarder",
    };
    // Filing 1: Chairman + Director.
    const first = await observer.observePerson({
      ...base,
      accession_number: "0001-25-000006",
      observation_index: 0,
      filing_date: "2023-01-10",
      titles: ["Chairman of the Board of Directors"],
    });
    // Filing 2 (later): only Director — the chairmanship has ended.
    await observer.observePerson({
      ...base,
      accession_number: "0001-25-000007",
      observation_index: 0,
      filing_date: "2024-06-15",
      titles: ["Director"],
    });
    const closed = await observer.closeUnassertedPersonRoles({
      accession_number: "0001-25-000007",
      extractor_id: "D",
      role_scope: "form-d:related-person",
      company_cik: 777,
      filing_date: "2024-06-15",
    });
    expect(closed).toBe(1);

    const roles = await personSetup.roleRepo.listForPerson(first.canonical_person_id, "1.0.0");
    const byTitle = new Map(roles.map((r) => [r.title, r]));
    expect(byTitle.get("Director")?.end_date).toBeNull();
    const chair = byTitle.get("Chairman of the Board of Directors");
    expect(chair?.start_date).toBe("2023-01-10");
    expect(chair?.end_date).toBe("2024-06-15");
  });

  it("an out-of-order older roster never closes a role a newer filing asserts", async () => {
    const base: Omit<PersonClaim, "accession_number" | "observation_index" | "filing_date"> = {
      extractor_id: "D",
      extractor_version: "1.0.0",
      source_filing_issuer_cik: 888,
      role_scope: "form-d:related-person",
      last_name: "Steady",
    };
    const { canonical_person_id } = await observer.observePerson({
      ...base,
      accession_number: "0001-25-000008",
      observation_index: 0,
      filing_date: "2024-06-15",
      titles: ["Director"],
    });
    // An OLDER filing that does not mention the person arrives late.
    const closed = await observer.closeUnassertedPersonRoles({
      accession_number: "0001-25-000009",
      extractor_id: "D",
      role_scope: "form-d:related-person",
      company_cik: 888,
      filing_date: "2023-02-01",
    });
    expect(closed).toBe(0);
    const roles = await personSetup.roleRepo.listForPerson(canonical_person_id, "1.0.0");
    expect(roles[0].end_date).toBeNull();
    // But the earlier assertion extends the tenure's start back.
    await observer.observePerson({
      ...base,
      accession_number: "0001-25-000009",
      observation_index: 0,
      filing_date: "2023-02-01",
      titles: ["Director"],
    });
    const extended = await personSetup.roleRepo.listForPerson(canonical_person_id, "1.0.0");
    expect(extended).toHaveLength(1);
    expect(extended[0].start_date).toBe("2023-02-01");
    expect(extended[0].last_seen_date).toBe("2024-06-15");
  });

  it("a departure and return produce two tenures", async () => {
    const base: Omit<PersonClaim, "accession_number" | "observation_index" | "filing_date"> = {
      extractor_id: "D",
      extractor_version: "1.0.0",
      source_filing_issuer_cik: 999,
      role_scope: "form-d:related-person",
      last_name: "Comeback",
    };
    const { canonical_person_id } = await observer.observePerson({
      ...base,
      accession_number: "0001-25-000010",
      observation_index: 0,
      filing_date: "2020-01-01",
      titles: ["Director"],
    });
    await observer.closeUnassertedPersonRoles({
      accession_number: "0001-25-000011",
      extractor_id: "D",
      role_scope: "form-d:related-person",
      company_cik: 999,
      filing_date: "2021-01-01",
    });
    await observer.observePerson({
      ...base,
      accession_number: "0001-25-000012",
      observation_index: 0,
      filing_date: "2022-01-01",
      titles: ["Director"],
    });
    const roles = await personSetup.roleRepo.listForPerson(canonical_person_id, "1.0.0");
    expect(roles).toHaveLength(2);
    const open = roles.find((r) => r.end_date === null);
    const done = roles.find((r) => r.end_date !== null);
    expect(done?.start_date).toBe("2020-01-01");
    expect(done?.end_date).toBe("2021-01-01");
    expect(open?.start_date).toBe("2022-01-01");
  });

  it("a re-extraction that now finds the person re-opens the tenure its accession closed", async () => {
    const base: Omit<PersonClaim, "accession_number" | "observation_index" | "filing_date"> = {
      extractor_id: "D",
      extractor_version: "1.0.0",
      source_filing_issuer_cik: 555,
      role_scope: "form-d:related-person",
      last_name: "Missed",
    };
    const { canonical_person_id } = await observer.observePerson({
      ...base,
      accession_number: "0001-25-000013",
      observation_index: 0,
      filing_date: "2023-05-01",
      titles: ["Director"],
    });
    // A buggy extraction of the next filing missed the person and closed the role.
    await observer.closeUnassertedPersonRoles({
      accession_number: "0001-25-000014",
      extractor_id: "D",
      role_scope: "form-d:related-person",
      company_cik: 555,
      filing_date: "2023-09-01",
    });
    // Re-extraction of the SAME filing now finds them: the closure is undone.
    await observer.observePerson({
      ...base,
      accession_number: "0001-25-000014",
      observation_index: 0,
      filing_date: "2023-09-01",
      titles: ["Director"],
    });
    const roles = await personSetup.roleRepo.listForPerson(canonical_person_id, "1.0.0");
    expect(roles).toHaveLength(1);
    expect(roles[0].end_date).toBeNull();
    expect(roles[0].last_seen_date).toBe("2023-09-01");
  });

  it("never mints tenures from placeholder titles", async () => {
    const { canonical_person_id } = await observer.observePerson({
      accession_number: "0001-25-000016",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      source_filing_issuer_cik: 333,
      last_name: "Signature",
      titles: ["Signer", "Authorized Representative"],
      filing_date: "2024-01-01",
      role_scope: "form-d:signature",
    });
    // The raw claim keeps its title rows...
    const obs = await personSetup.personObsRepo.getByNaturalKey("0001-25-000016", "D", 0);
    expect(await personSetup.titleRepo.listForObservation(obs!.observation_id)).toEqual([
      "Signer",
      "Authorized Representative",
    ]);
    // ...but no dated role tenure is fabricated from them.
    expect(await personSetup.roleRepo.listForPerson(canonical_person_id, "1.0.0")).toHaveLength(0);
  });

  it("splits compound titles into separate canonical tenure rows", async () => {
    const { canonical_person_id } = await observer.observePerson({
      accession_number: "0001-25-000015",
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      observation_index: 0,
      source_filing_issuer_cik: 444,
      last_name: "Multi",
      titles: ["President, Chief Executive Officer and Director"],
      filing_date: "2024-02-02",
      role_scope: "s1:management",
    });
    const roles = await personSetup.roleRepo.listForPerson(canonical_person_id, "1.0.0");
    expect(roles.map((r) => r.title).sort()).toEqual([
      "Chief Executive Officer",
      "Director",
      "President",
    ]);
  });
});

describe("EntityObserver.observeCompany", () => {
  let companySetup: ReturnType<typeof makeCompanyRepos>;
  let observer: EntityObserver;

  beforeEach(() => {
    companySetup = makeCompanyRepos();
    observer = new EntityObserver({
      personObservationRepo: undefined as any,
      personObservationTitleRepo: undefined as any,
      companyObservationRepo: companySetup.companyObsRepo,
      personIdentityLinkRepo: undefined as any,
      companyIdentityLinkRepo: companySetup.identityLinkRepo,
      personResolver: undefined as any,
      companyResolver: companySetup.resolver,
      canonicalPersonAddressRepo: undefined as any,
      canonicalPersonPhoneRepo: undefined as any,
      canonicalCompanyAddressRepo: undefined as any,
      canonicalCompanyPhoneRepo: undefined as any,
      personRoleRepo: undefined as any,
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
