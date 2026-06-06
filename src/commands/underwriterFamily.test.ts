/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { setupAllDatabases } from "../config/setupAllDatabases";
import { CanonicalUnderwriterFamilyRepo } from "../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { CanonicalUnderwriterFamilyAliasRepo } from "../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import { UnderwriterLinkRepo } from "../storage/canonical/UnderwriterLinkRepo";
import { ipoIssuersByUnderwriterFamilyName } from "./underwriterFamily";

describe("ipoIssuersByUnderwriterFamilyName", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("returns issuer CIKs for the named underwriter family", async () => {
    await new CanonicalUnderwriterFamilyRepo().create({
      canonical_underwriter_family_id: "fam-1",
      resolver_version: "1.0.0",
      display_name: "Goldman Sachs",
      normalized_name: "goldman sachs",
      created_at: new Date().toISOString(),
    });
    await new UnderwriterLinkRepo().save({
      accession_number: "0000000000-26-000001",
      extractor_id: "S-1",
      observation_index: 5,
      issuer_cik: 1018724,
      underwriter_canonical_company_id: "co-1",
      underwriter_family_id: "fam-1",
      role_detail: "lead",
      shares_allocated: null,
      over_allotment_shares: null,
      resolver_version: "1.0.0",
    });
    expect(await ipoIssuersByUnderwriterFamilyName("Goldman Sachs", "1.0.0")).toEqual([1018724]);
  });

  it("unions issuer CIKs across aliased variant families", async () => {
    const families = new CanonicalUnderwriterFamilyRepo();
    await families.create({
      canonical_underwriter_family_id: "fam-1",
      resolver_version: "1.0.0",
      display_name: "Goldman Sachs",
      normalized_name: "goldman sachs",
      created_at: new Date().toISOString(),
    });
    await families.create({
      canonical_underwriter_family_id: "gs-variant",
      resolver_version: "1.0.0",
      display_name: "Goldman Sachs Group",
      normalized_name: "goldman sachs group",
      created_at: new Date().toISOString(),
    });
    // The AI-emitted variant is merged into the canonical family.
    await new CanonicalUnderwriterFamilyAliasRepo().add("gs-variant", "fam-1", "variant", "op");

    const links = new UnderwriterLinkRepo();
    await links.save({
      accession_number: "0000000000-26-000001",
      extractor_id: "S-1",
      observation_index: 5,
      issuer_cik: 1018724,
      underwriter_canonical_company_id: "co-1",
      underwriter_family_id: "fam-1",
      role_detail: "lead",
      shares_allocated: null,
      over_allotment_shares: null,
      resolver_version: "1.0.0",
    });
    await links.save({
      accession_number: "0000000000-26-000002",
      extractor_id: "S-1",
      observation_index: 3,
      issuer_cik: 2222222,
      underwriter_canonical_company_id: "co-2",
      underwriter_family_id: "gs-variant",
      role_detail: "bookrunner",
      shares_allocated: null,
      over_allotment_shares: null,
      resolver_version: "1.0.0",
    });

    const ciks = (await ipoIssuersByUnderwriterFamilyName("Goldman Sachs", "1.0.0")).sort();
    expect(ciks).toEqual([1018724, 2222222]);
  });
});
