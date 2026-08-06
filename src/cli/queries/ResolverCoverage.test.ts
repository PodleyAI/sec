/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { PersonObservationRepo } from "../../storage/observation/PersonObservationRepo";
import { PersonIdentityLinkRepo } from "../../storage/canonical/PersonIdentityLinkRepo";
import { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "../../storage/observation/PersonObservationSchema";
import { PERSON_IDENTITY_LINK_REPOSITORY_TOKEN } from "../../storage/canonical/PersonIdentityLinkSchema";
import { computeResolverCoverage } from "./ResolverCoverage";
import { clearResolverExtensionsForTesting } from "../../resolver/resolverExtensions";
import { registerSecResolvers } from "../../config/registerResolvers";
import { CompanyObservationRepo } from "../../storage/observation/CompanyObservationRepo";
import { SpacSponsorLinkRepo } from "../../storage/canonical/SpacSponsorLinkRepo";
import { UnderwriterLinkRepo } from "../../storage/canonical/UnderwriterLinkRepo";
import type { SpacSponsorLink } from "../../storage/canonical/SpacSponsorLinkSchema";
import type { UnderwriterLink } from "../../storage/canonical/UnderwriterLinkSchema";

function sponsorLink(
  accession_number: string,
  observation_index: number,
  resolver_version: string
): SpacSponsorLink {
  return {
    accession_number,
    extractor_id: "S-1",
    observation_index,
    issuer_cik: 1234567,
    sponsor_canonical_company_id: "company-1",
    sponsor_family_id: `family-${resolver_version}`,
    resolver_version,
  };
}

function underwriterLink(
  accession_number: string,
  observation_index: number,
  resolver_version: string
): UnderwriterLink {
  return {
    accession_number,
    extractor_id: "S-1",
    observation_index,
    issuer_cik: 1234567,
    underwriter_canonical_company_id: "company-1",
    underwriter_family_id: `family-${resolver_version}`,
    role_detail: "lead",
    shares_allocated: null,
    over_allotment_shares: null,
    resolver_version,
  };
}

describe("computeResolverCoverage", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    clearResolverExtensionsForTesting();
    registerSecResolvers();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
    clearResolverExtensionsForTesting();
  });

  it("returns correct coverage fractions for person resolver", async () => {
    const obsRepo = new PersonObservationRepo();
    const linkRepo = new PersonIdentityLinkRepo();

    // Seed 3 PersonObservation rows
    const obs1 = await obsRepo.upsertByNaturalKey({
      accession_number: "0001000000-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const obs2 = await obsRepo.upsertByNaturalKey({
      accession_number: "0001000000-25-000002",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const obs3 = await obsRepo.upsertByNaturalKey({
      accession_number: "0001000000-25-000003",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      created_at: "2026-05-22T00:00:00.000Z",
    });

    // Seed 2 PersonIdentityLink rows at resolver_version "1.0.0"
    await linkRepo.upsert(obs1.observation_id, "1.0.0", "canonical-person-1");
    await linkRepo.upsert(obs2.observation_id, "1.0.0", "canonical-person-2");

    // Seed 1 PersonIdentityLink row at resolver_version "2.0.0"
    await linkRepo.upsert(obs3.observation_id, "2.0.0", "canonical-person-3");

    const result100 = await computeResolverCoverage("person", "1.0.0");
    expect(result100.numerator).toBe(2);
    expect(result100.denominator).toBe(3);
    expect(result100.fraction).toBeCloseTo(2 / 3);

    const result200 = await computeResolverCoverage("person", "2.0.0");
    expect(result200.numerator).toBe(1);
    expect(result200.denominator).toBe(3);
    expect(result200.fraction).toBeCloseTo(1 / 3);
  });

  it("returns zero coverage for company when no observations exist", async () => {
    const result = await computeResolverCoverage("company", "1.0.0");
    expect(result.numerator).toBe(0);
    expect(result.denominator).toBe(0);
    expect(result.fraction).toBe(0);
  });

  it("uses count() (not listAll/getAll) to compute coverage (S-MAIN-05)", async () => {
    // Stub the underlying ITabularStorage instances so that every row-materializing
    // path (getAll / query / records / pages) throws if called, while count()
    // returns deterministic values. If computeResolverCoverage still materializes
    // the full table this test will fail loudly with the planted error.
    const obsStorage = globalServiceRegistry.get(PERSON_OBSERVATION_REPOSITORY_TOKEN);
    const linkStorage = globalServiceRegistry.get(PERSON_IDENTITY_LINK_REPOSITORY_TOKEN);

    let countCalls = 0;
    let lastLinkCriteria: Record<string, unknown> | undefined;

    const refuse = (name: string) => {
      throw new Error(`forbidden materialization path '${name}' was called`);
    };

    // We only need to intercept the methods ResolverCoverage might call.
    (obsStorage as { getAll: () => Promise<unknown> }).getAll = async () =>
      refuse("PersonObservation.getAll");
    (obsStorage as { count: (c?: unknown) => Promise<number> }).count = async () => {
      countCalls++;
      return 17;
    };
    (linkStorage as { getAll: () => Promise<unknown> }).getAll = async () =>
      refuse("PersonIdentityLink.getAll");
    (linkStorage as { count: (c?: Record<string, unknown>) => Promise<number> }).count = async (
      criteria
    ) => {
      countCalls++;
      lastLinkCriteria = criteria;
      return 11;
    };

    const result = await computeResolverCoverage("person", "1.0.0");
    expect(result.numerator).toBe(11);
    expect(result.denominator).toBe(17);
    expect(result.fraction).toBeCloseTo(11 / 17);
    expect(countCalls).toBe(2);
    expect(lastLinkCriteria).toEqual({ resolver_version: "1.0.0" });
  });

  it("reports sponsor-family coverage from spac_sponsor_link rows", async () => {
    const links = new SpacSponsorLinkRepo();
    await links.save(sponsorLink("0001000000-25-000001", 0, "1.0.0"));
    await links.save(sponsorLink("0001000000-25-000002", 0, "1.0.0"));
    await links.save(sponsorLink("0001000000-25-000003", 0, "2.0.0"));

    const at100 = await computeResolverCoverage("sponsor-family", "1.0.0");
    expect(at100).toMatchObject({ numerator: 2, denominator: 3 });
    expect(at100.fraction).toBeCloseTo(2 / 3);

    const at200 = await computeResolverCoverage("sponsor-family", "2.0.0");
    expect(at200).toMatchObject({ numerator: 1, denominator: 3 });
  });

  it("reports underwriter-family coverage from underwriter_link rows", async () => {
    const links = new UnderwriterLinkRepo();
    await links.save(underwriterLink("0001000000-25-000001", 0, "1.0.0"));
    await links.save(underwriterLink("0001000000-25-000001", 1, "2.0.0"));

    const at100 = await computeResolverCoverage("underwriter-family", "1.0.0");
    expect(at100).toMatchObject({ numerator: 1, denominator: 2 });
    expect(at100.fraction).toBeCloseTo(0.5);
  });

  it("reports zero family coverage when no link rows exist", async () => {
    for (const kind of ["sponsor-family", "underwriter-family"]) {
      const result = await computeResolverCoverage(kind, "1.0.0");
      expect(result).toMatchObject({ numerator: 0, denominator: 0, fraction: 0 });
    }
  });

  it("family coverage does not read the company tier", async () => {
    // A company observation with no family link must not leak into the family
    // denominator: the family tier counts its own per-filing link rows.
    await new CompanyObservationRepo().upsertByNaturalKey({
      accession_number: "0001000000-25-000009",
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      observation_index: 0,
      name: "Some Sponsor LLC",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const result = await computeResolverCoverage("sponsor-family", "1.0.0");
    expect(result).toMatchObject({ numerator: 0, denominator: 0 });
  });
});
