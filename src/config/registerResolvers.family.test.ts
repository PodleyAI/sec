/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { registerSecResolvers } from "./registerResolvers";
import { resetDependencyInjectionsForTesting } from "./TestingDI";
import { setupAllDatabases } from "./setupAllDatabases";
import { clearResolverExtensionsForTesting } from "../resolver/resolverExtensions";
import { dropPrevious, promote, startDev } from "../storage/versioning/ceremonies";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../storage/versioning/ComponentVersionSchema";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../storage/versioning/ExtractorRunSchema";
import { ExtractorRunRepo } from "../storage/versioning/ExtractorRunRepo";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "../storage/versioning/VersionEventSchema";
import { VersionEventRepo } from "../storage/versioning/VersionEventRepo";
import { VersionRegistry } from "../storage/versioning/VersionRegistry";
import { CanonicalCompanyAddressRepo } from "../storage/canonical/CanonicalCompanyAddressRepo";
import { CanonicalCompanyRepo } from "../storage/canonical/CanonicalCompanyRepo";
import { CanonicalPersonRepo } from "../storage/canonical/CanonicalPersonRepo";
import { CanonicalSponsorFamilyAliasRepo } from "../storage/canonical/CanonicalSponsorFamilyAliasRepo";
import { CanonicalSponsorFamilyRepo } from "../storage/canonical/CanonicalSponsorFamilyRepo";
import { CanonicalUnderwriterFamilyAliasRepo } from "../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import { CanonicalUnderwriterFamilyRepo } from "../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import { FamilyDescriptionRepo } from "../storage/canonical/FamilyDescriptionRepo";
import { SpacSponsorLinkRepo } from "../storage/canonical/SpacSponsorLinkRepo";
import { SponsorFamilyMembershipRepo } from "../storage/canonical/SponsorFamilyMembershipRepo";
import { UnderwriterFamilyMembershipRepo } from "../storage/canonical/UnderwriterFamilyMembershipRepo";
import { UnderwriterLinkRepo } from "../storage/canonical/UnderwriterLinkRepo";

const PREVIOUS = "1.0.0";
const CURRENT = "2.0.0";

const SPONSOR_FAMILY_PREV = "10000000-0000-0000-0000-000000000001";
const SPONSOR_FAMILY_CUR = "10000000-0000-0000-0000-000000000002";
const UNDERWRITER_FAMILY_PREV = "20000000-0000-0000-0000-000000000001";
const COMPANY_ID = "30000000-0000-0000-0000-000000000001";
const PERSON_ID = "40000000-0000-0000-0000-000000000001";
const ADDRESS_HASH = "addr-hash-1";

function buildDeps() {
  return {
    reg: new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)),
    events: new VersionEventRepo(globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN)),
    runs: new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)),
  };
}

/** Rotate a resolver kind to current=2.0.0 / previous=1.0.0. */
async function openPreviousSlot(id: string): Promise<void> {
  const { reg, events, runs } = buildDeps();
  await startDev({
    reg,
    events,
    kind: "resolver",
    id,
    semver: CURRENT,
    bump: "major",
    targetCount: 0,
    notes: null,
  });
  await promote({ reg, events, runs, kind: "resolver", id, force: true, notes: null });
}

/** Seed both family tiers at both versions, plus the company/person tiers. */
async function seedAllTiers(): Promise<void> {
  await new CanonicalSponsorFamilyRepo().create({
    canonical_sponsor_family_id: SPONSOR_FAMILY_PREV,
    resolver_version: PREVIOUS,
    display_name: "Churchill Capital",
    normalized_name: "CHURCHILL CAPITAL",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  await new CanonicalSponsorFamilyRepo().create({
    canonical_sponsor_family_id: SPONSOR_FAMILY_CUR,
    resolver_version: CURRENT,
    display_name: "Churchill Capital",
    normalized_name: "CHURCHILL CAPITAL",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  await new SponsorFamilyMembershipRepo().record({
    resolver_version: PREVIOUS,
    canonical_company_id: COMPANY_ID,
    canonical_sponsor_family_id: SPONSOR_FAMILY_PREV,
    seen_at: "2026-01-01T00:00:00.000Z",
  });
  await new SponsorFamilyMembershipRepo().record({
    resolver_version: CURRENT,
    canonical_company_id: COMPANY_ID,
    canonical_sponsor_family_id: SPONSOR_FAMILY_CUR,
    seen_at: "2026-01-01T00:00:00.000Z",
  });
  await new SpacSponsorLinkRepo().save({
    accession_number: "0001000000-25-000001",
    extractor_id: "S-1",
    observation_index: 0,
    issuer_cik: 1111111,
    sponsor_canonical_company_id: COMPANY_ID,
    sponsor_family_id: SPONSOR_FAMILY_PREV,
    resolver_version: PREVIOUS,
  });
  await new SpacSponsorLinkRepo().save({
    accession_number: "0001000000-25-000002",
    extractor_id: "S-1",
    observation_index: 0,
    issuer_cik: 2222222,
    sponsor_canonical_company_id: COMPANY_ID,
    sponsor_family_id: SPONSOR_FAMILY_CUR,
    resolver_version: CURRENT,
  });

  // The underwriter tier at the SAME version string — a sponsor purge must not
  // reach it, the two kinds carry independent version lines.
  await new CanonicalUnderwriterFamilyRepo().create({
    canonical_underwriter_family_id: UNDERWRITER_FAMILY_PREV,
    resolver_version: PREVIOUS,
    display_name: "Goldman Sachs",
    normalized_name: "GOLDMAN SACHS",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  await new UnderwriterFamilyMembershipRepo().record({
    resolver_version: PREVIOUS,
    canonical_company_id: COMPANY_ID,
    canonical_underwriter_family_id: UNDERWRITER_FAMILY_PREV,
    seen_at: "2026-01-01T00:00:00.000Z",
  });
  await new UnderwriterLinkRepo().save({
    accession_number: "0001000000-25-000001",
    extractor_id: "S-1",
    observation_index: 1,
    issuer_cik: 1111111,
    underwriter_canonical_company_id: COMPANY_ID,
    underwriter_family_id: UNDERWRITER_FAMILY_PREV,
    role_detail: "lead",
    shares_allocated: null,
    over_allotment_shares: null,
    resolver_version: PREVIOUS,
  });

  // Company / person tiers at the same version string — the family purge must
  // never delete these; they belong to their own resolvers' ceremonies.
  await new CanonicalCompanyRepo().create({
    canonical_company_id: COMPANY_ID,
    resolver_version: PREVIOUS,
    display_name: "Churchill Sponsor LLC",
    cik: null,
    crd_number: null,
    normalized_name: "CHURCHILL SPONSOR LLC",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  await new CompanyIdentityLinkRepo().upsert(1, PREVIOUS, COMPANY_ID);
  await new CanonicalCompanyAddressRepo().replaceAggregate({
    canonical_company_id: COMPANY_ID,
    address_hash_id: ADDRESS_HASH,
    resolver_version: PREVIOUS,
    observation_count: 1,
    first_seen_at: "2026-01-01T00:00:00.000Z",
    last_seen_at: "2026-01-01T00:00:00.000Z",
  });
  await new CanonicalPersonRepo().create({
    canonical_person_id: PERSON_ID,
    resolver_version: PREVIOUS,
    display_first: "Alice",
    display_middle: null,
    display_last: "Smith",
    display_suffix: null,
    cik: null,
    normalized_first: "alice",
    normalized_middle: null,
    normalized_last: "smith",
    normalized_suffix: null,
    source_filing_issuer_cik: null,
    created_at: "2026-01-01T00:00:00.000Z",
  });

  // Not version-scoped: aliases and editorial descriptions outlive a purge.
  await new CanonicalSponsorFamilyAliasRepo().add(
    "10000000-0000-0000-0000-0000000000ff",
    SPONSOR_FAMILY_CUR,
    "variant spelling",
    "operator"
  );
  await new CanonicalUnderwriterFamilyAliasRepo().add(
    "20000000-0000-0000-0000-0000000000ff",
    UNDERWRITER_FAMILY_PREV,
    "subsidiary",
    "operator"
  );
  await new FamilyDescriptionRepo().setDescription(
    "sponsor-family",
    "CHURCHILL CAPITAL",
    "Klein-family sponsor group."
  );
  await new FamilyDescriptionRepo().setDescription(
    "underwriter-family",
    "GOLDMAN SACHS",
    "Bulge-bracket underwriter."
  );
}

describe("family-tier resolver version ceremonies", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    // Register resolver kinds before setupAllDatabases so its
    // bootstrapComponentVersions() seeds the family resolver current slots too.
    clearResolverExtensionsForTesting();
    registerSecResolvers();
    await setupAllDatabases();
    await seedAllTiers();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
    clearResolverExtensionsForTesting();
  });

  it("drop-previous refuses sponsor-family and purges nothing", async () => {
    await openPreviousSlot("sponsor-family");
    const { reg, events } = buildDeps();

    // No `dropPrevious` closure is registered for the family kinds. Unlike the
    // person/company tier, whose identity links are derived and rebuildable by
    // `sec resolve`, the family link row IS the attribution and `sec resolve`
    // refuses family kinds — so a purge here has no rebuild path short of
    // re-extracting every affected filing.
    await expect(
      dropPrevious({ reg, events, kind: "resolver", id: "sponsor-family", notes: null })
    ).rejects.toThrow(/not supported for resolver kind 'sponsor-family'/i);

    // Every family row survives, at both versions and on both tiers.
    expect(await new CanonicalSponsorFamilyRepo().listForResolverVersion(PREVIOUS)).toHaveLength(1);
    expect(
      await new SponsorFamilyMembershipRepo().listCompaniesForFamily(PREVIOUS, SPONSOR_FAMILY_PREV)
    ).toEqual([COMPANY_ID]);
    expect(await new SpacSponsorLinkRepo().count({ resolver_version: PREVIOUS })).toBe(1);
    expect(await new SpacSponsorLinkRepo().count({ resolver_version: CURRENT })).toBe(1);
    expect(
      await new CanonicalUnderwriterFamilyRepo().listForResolverVersion(PREVIOUS)
    ).toHaveLength(1);
    expect(await new UnderwriterLinkRepo().count({ resolver_version: PREVIOUS })).toBe(1);

    // The slot is left in place too, so the refusal is not half-applied.
    expect(await reg.getPrevious("resolver", "sponsor-family")).toBeDefined();
  });

  it("drop-previous refuses underwriter-family and purges nothing", async () => {
    await openPreviousSlot("underwriter-family");
    const { reg, events } = buildDeps();

    await expect(
      dropPrevious({ reg, events, kind: "resolver", id: "underwriter-family", notes: null })
    ).rejects.toThrow(/not supported for resolver kind 'underwriter-family'/i);

    expect(
      await new CanonicalUnderwriterFamilyRepo().listForResolverVersion(PREVIOUS)
    ).toHaveLength(1);
    expect(
      await new UnderwriterFamilyMembershipRepo().listCompaniesForFamily(
        PREVIOUS,
        UNDERWRITER_FAMILY_PREV
      )
    ).toEqual([COMPANY_ID]);
    expect(await new UnderwriterLinkRepo().count({ resolver_version: PREVIOUS })).toBe(1);
    expect(await reg.getPrevious("resolver", "underwriter-family")).toBeDefined();
  });

  it("drop-previous refuses when the family kind has no previous slot", async () => {
    const { reg, events } = buildDeps();
    await expect(
      dropPrevious({ reg, events, kind: "resolver", id: "sponsor-family", notes: null })
    ).rejects.toThrow(/no previous slot/i);

    // Nothing was purged by the refusal.
    expect(await new SpacSponsorLinkRepo().count({ resolver_version: PREVIOUS })).toBe(1);
  });
});
