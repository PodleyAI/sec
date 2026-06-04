/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SpacSponsorLinkRepo } from "./SpacSponsorLinkRepo";

describe("SpacSponsorLinkRepo", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("saves a link, clears by accession, and lists issuers for a family", async () => {
    const repo = new SpacSponsorLinkRepo();
    await repo.save({
      accession_number: "0000000000-26-000001",
      extractor_id: "S-1",
      observation_index: 5,
      issuer_cik: 1848507,
      sponsor_canonical_company_id: "co-1",
      sponsor_family_id: "fam-1",
      resolver_version: "1.0.0",
    });
    expect(await repo.listIssuerCiksForFamily("fam-1")).toEqual([1848507]);
    await repo.clear("0000000000-26-000001");
    expect(await repo.listIssuerCiksForFamily("fam-1")).toEqual([]);
  });
});
