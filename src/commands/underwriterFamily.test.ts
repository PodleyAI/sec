/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { setupAllDatabases } from "../config/setupAllDatabases";
import { CanonicalUnderwriterFamilyRepo } from "../storage/canonical/CanonicalUnderwriterFamilyRepo";
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
});
