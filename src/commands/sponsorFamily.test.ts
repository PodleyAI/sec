/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { setupAllDatabases } from "../config/setupAllDatabases";
import { spacIssuersByFamilyName } from "./sponsorFamily";
import { CanonicalSponsorFamilyRepo } from "../storage/canonical/CanonicalSponsorFamilyRepo";
import { CanonicalSponsorFamilyAliasRepo } from "../storage/canonical/CanonicalSponsorFamilyAliasRepo";
import { SpacSponsorLinkRepo } from "../storage/canonical/SpacSponsorLinkRepo";
import { normalizeSponsorFamilyName } from "../resolver/SponsorFamilyResolver";

async function makeFamily(id: string, displayName: string): Promise<void> {
  await new CanonicalSponsorFamilyRepo().create({
    canonical_sponsor_family_id: id,
    resolver_version: "1.0.0",
    display_name: displayName,
    normalized_name: normalizeSponsorFamilyName(displayName),
    created_at: new Date().toISOString(),
  });
}

async function link(accession: string, idx: number, cik: number, familyId: string): Promise<void> {
  await new SpacSponsorLinkRepo().save({
    accession_number: accession,
    extractor_id: "S-1",
    observation_index: idx,
    issuer_cik: cik,
    sponsor_canonical_company_id: "co-" + idx,
    sponsor_family_id: familyId,
    resolver_version: "1.0.0",
  });
}

describe("spacIssuersByFamilyName", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("resolves a family by name and returns its issuer CIKs", async () => {
    await makeFamily("fam-1", "Acme Sponsor");
    await link("a", 0, 999, "fam-1");
    expect(await spacIssuersByFamilyName("Acme Sponsor", "1.0.0")).toEqual([999]);
  });

  it("returns [] for an unknown family", async () => {
    expect(await spacIssuersByFamilyName("Nobody", "1.0.0")).toEqual([]);
  });

  it("unions issuers across a variant family aliased into the target", async () => {
    await makeFamily("fam-target", "Acme Sponsor");
    await makeFamily("fam-variant", "Acme Sponsors"); // AI variant, distinct normalized name
    await link("a", 0, 111, "fam-target");
    await link("b", 0, 222, "fam-variant"); // link created under the variant id
    await new CanonicalSponsorFamilyAliasRepo().add("fam-variant", "fam-target", "variant", "op");

    // Querying by EITHER name returns BOTH issuers (alias-aware union).
    const byTarget = await spacIssuersByFamilyName("Acme Sponsor", "1.0.0");
    expect([...byTarget].sort((a, b) => a - b)).toEqual([111, 222]);
    const byVariant = await spacIssuersByFamilyName("Acme Sponsors", "1.0.0");
    expect([...byVariant].sort((a, b) => a - b)).toEqual([111, 222]);
  });
});
