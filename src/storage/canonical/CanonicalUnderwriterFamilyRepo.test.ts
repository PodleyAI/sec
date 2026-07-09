/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { CanonicalUnderwriterFamilyRepo } from "./CanonicalUnderwriterFamilyRepo";

describe("CanonicalUnderwriterFamilyRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("creates and finds by resolver version + normalized name", async () => {
    const repo = new CanonicalUnderwriterFamilyRepo();
    await repo.create({
      canonical_underwriter_family_id: "uw-1",
      resolver_version: "1.0.0",
      display_name: "Goldman Sachs",
      normalized_name: "GOLDMAN SACHS",
      created_at: new Date().toISOString(),
    });
    const found = await repo.findByResolverAndName("1.0.0", "GOLDMAN SACHS");
    expect(found?.canonical_underwriter_family_id).toBe("uw-1");
  });
});
