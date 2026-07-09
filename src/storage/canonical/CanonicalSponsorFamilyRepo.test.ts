/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { CanonicalSponsorFamilyRepo } from "./CanonicalSponsorFamilyRepo";

describe("CanonicalSponsorFamilyRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("creates and finds by resolver version + normalized name", async () => {
    const repo = new CanonicalSponsorFamilyRepo();
    await repo.create({
      canonical_sponsor_family_id: "fam-1",
      resolver_version: "1.0.0",
      display_name: "Pershing Square Sponsor",
      normalized_name: "PERSHING SQUARE SPONSOR",
      created_at: new Date().toISOString(),
    });
    const found = await repo.findByResolverAndName("1.0.0", "PERSHING SQUARE SPONSOR");
    expect(found?.canonical_sponsor_family_id).toBe("fam-1");
  });
});
