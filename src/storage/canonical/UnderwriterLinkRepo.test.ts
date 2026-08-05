/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { UnderwriterLinkRepo } from "./UnderwriterLinkRepo";

describe("UnderwriterLinkRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("saves links and lists issuer CIKs for a family", async () => {
    const repo = new UnderwriterLinkRepo();
    await repo.save({
      accession_number: "0000000000-26-000001",
      extractor_id: "S-1",
      observation_index: 5,
      issuer_cik: 1018724,
      underwriter_canonical_company_id: "co-1",
      underwriter_family_id: "fam-1",
      role_detail: "lead",
      shares_allocated: 3000000,
      over_allotment_shares: 450000,
      resolver_version: "1.0.0",
    });
    expect(await repo.listIssuerCiksForFamily("fam-1")).toEqual([1018724]);
  });

  it("clears links for an accession", async () => {
    const repo = new UnderwriterLinkRepo();
    await repo.save({
      accession_number: "0000000000-26-000001",
      extractor_id: "S-1",
      observation_index: 5,
      issuer_cik: 1018724,
      underwriter_canonical_company_id: "co-1",
      underwriter_family_id: "fam-1",
      role_detail: "co-manager",
      shares_allocated: null,
      over_allotment_shares: null,
      resolver_version: "1.0.0",
    });
    await repo.clear("0000000000-26-000001");
    expect(await repo.listIssuerCiksForFamily("fam-1")).toEqual([]);
  });

  it("deleteForResolverVersion removes only that version's rows", async () => {
    const repo = new UnderwriterLinkRepo();
    const row = (accession: string, resolver_version: string) => ({
      accession_number: accession,
      extractor_id: "S-1",
      observation_index: 0,
      issuer_cik: 1018724,
      underwriter_canonical_company_id: "co-1",
      underwriter_family_id: `fam-${resolver_version}`,
      role_detail: "lead" as const,
      shares_allocated: null,
      over_allotment_shares: null,
      resolver_version,
    });
    await repo.save(row("0000000000-26-000001", "1.0.0"));
    await repo.save(row("0000000000-26-000002", "1.0.0"));
    await repo.save(row("0000000000-26-000003", "2.0.0"));

    expect(await repo.count()).toBe(3);
    expect(await repo.deleteForResolverVersion("1.0.0")).toBe(2);
    expect(await repo.count({ resolver_version: "1.0.0" })).toBe(0);
    expect(await repo.count({ resolver_version: "2.0.0" })).toBe(1);
  });
});
