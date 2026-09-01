/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
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
import { PersonObservationTitleRepo } from "../storage/observation/PersonObservationTitleRepo";
import {
  PersonObservationTitlePrimaryKeyNames,
  PersonObservationTitleSchema,
  type PersonObservationTitle,
} from "../storage/observation/PersonObservationTitleSchema";
import type { CompanyClaim, PersonClaim } from "./EntityObserver";
import { canonicalRoleTitles, EntityObserver } from "./EntityObserver";

function makePersonRepos() {
  const personObsRepo = new PersonObservationRepo({
    personObservationRepository: new InMemoryTabularStorage<
      typeof PersonObservationSchema,
      typeof PersonObservationPrimaryKeyNames,
      PersonObservation
    >(PersonObservationSchema, PersonObservationPrimaryKeyNames, []),
  });
  const titleRepo = new PersonObservationTitleRepo({
    personObservationTitleRepository: new InMemoryTabularStorage<
      typeof PersonObservationTitleSchema,
      typeof PersonObservationTitlePrimaryKeyNames,
      PersonObservationTitle
    >(PersonObservationTitleSchema, PersonObservationTitlePrimaryKeyNames, []),
  });
  return { personObsRepo, titleRepo };
}

function makeCompanyRepos() {
  const companyObsRepo = new CompanyObservationRepo({
    companyObservationRepository: new InMemoryTabularStorage<
      typeof CompanyObservationSchema,
      typeof CompanyObservationPrimaryKeyNames,
      CompanyObservation
    >(CompanyObservationSchema, CompanyObservationPrimaryKeyNames, []),
  });
  return { companyObsRepo };
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
    });
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

  it("keeps the writer's title text as filed, uncanonicalized", async () => {
    // The observation child rows are the record of what the filing said; the
    // canonicalization that decides tenures happens where tenures are derived,
    // over these rows. Storing the canonical form here would lose the filing's
    // own wording with nothing gained.
    const result = await observer.observePerson({
      accession_number: "0001-25-000015",
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      observation_index: 0,
      source_filing_issuer_cik: 444,
      last_name: "Multi",
      titles: ["President, Chief Executive Officer and Director", "Signer"],
      filing_date: "2024-02-02",
      role_scope: "s1:management",
    });

    expect(await personSetup.titleRepo.listForObservation(result.observation_id)).toEqual([
      "President, Chief Executive Officer and Director",
      "Signer",
    ]);
  });

  it("is idempotent on the natural key", async () => {
    const claim: PersonClaim = {
      accession_number: "0001-25-000005",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      last_name: "Same",
    };
    const first = await observer.observePerson(claim);
    const second = await observer.observePerson(claim);
    expect(second.observation_id).toBe(first.observation_id);
    expect(await personSetup.personObsRepo.count()).toBe(1);
  });
});

describe("canonicalRoleTitles", () => {
  // What a title means for tenure purposes is decided here and nowhere else:
  // `rebuildPersonRoles` runs every stored title list through this function, so
  // a title that survives it becomes a tenure and one that does not never can.

  it("filters placeholder titles, which name an act rather than a role", () => {
    expect(canonicalRoleTitles(["Signer", "Authorized Representative"])).toEqual([]);
    expect(canonicalRoleTitles(["Sales Compensation Recipient", "Connection"])).toEqual([]);
  });

  it("splits a compound title into one canonical title per role", () => {
    expect(
      [...canonicalRoleTitles(["President, Chief Executive Officer and Director"])].sort()
    ).toEqual(["Chief Executive Officer", "Director", "President"]);
  });

  it("keeps a real title alongside a filtered placeholder", () => {
    expect(canonicalRoleTitles(["Signer", "Director"])).toEqual(["Director"]);
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
    });
  });

  it("writes the observation row with the name as filed and its normalized form", async () => {
    const claim: CompanyClaim = {
      accession_number: "0001-25-000002",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 9999,
      name: "Acme Corporation LLC",
    };

    const result = await observer.observeCompany(claim);

    expect(result.observation_id).toBeGreaterThan(0);
    const row = await companySetup.companyObsRepo.getById(result.observation_id);
    expect(row?.name).toBe("Acme Corporation LLC");
    expect(row?.normalized_name).toBeTruthy();
    expect(row?.cik).toBe(9999);
  });
});
