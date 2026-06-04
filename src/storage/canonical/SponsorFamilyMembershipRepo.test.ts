/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SponsorFamilyMembershipRepo } from "./SponsorFamilyMembershipRepo";

describe("SponsorFamilyMembershipRepo", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("records membership idempotently and lists legal sponsors for a family", async () => {
    const repo = new SponsorFamilyMembershipRepo();
    const row = {
      resolver_version: "1.0.0",
      canonical_company_id: "co-1",
      canonical_sponsor_family_id: "fam-1",
      seen_at: new Date().toISOString(),
    };
    await repo.record(row);
    await repo.record({ ...row, seen_at: new Date().toISOString() });
    const members = await repo.listCompaniesForFamily("1.0.0", "fam-1");
    expect(members).toEqual(["co-1"]);
  });
});
