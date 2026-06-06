/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { UnderwriterFamilyMembershipRepo } from "./UnderwriterFamilyMembershipRepo";

describe("UnderwriterFamilyMembershipRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("records memberships and lists companies for a family", async () => {
    const repo = new UnderwriterFamilyMembershipRepo();
    await repo.record({
      resolver_version: "1.0.0",
      canonical_company_id: "co-1",
      canonical_underwriter_family_id: "fam-1",
      seen_at: new Date().toISOString(),
    });
    await repo.record({
      resolver_version: "1.0.0",
      canonical_company_id: "co-2",
      canonical_underwriter_family_id: "fam-1",
      seen_at: new Date().toISOString(),
    });
    const companies = (await repo.listCompaniesForFamily("1.0.0", "fam-1")).sort();
    expect(companies).toEqual(["co-1", "co-2"]);
  });
});
