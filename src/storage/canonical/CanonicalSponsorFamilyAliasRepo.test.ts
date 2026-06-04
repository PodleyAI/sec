/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { CanonicalSponsorFamilyAliasRepo } from "./CanonicalSponsorFamilyAliasRepo";

describe("CanonicalSponsorFamilyAliasRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("resolves an alias to its target and rejects chains", async () => {
    const repo = new CanonicalSponsorFamilyAliasRepo();
    await repo.add("fam-a", "fam-b", "merge variant", "op");
    expect(await repo.resolve("fam-a")).toBe("fam-b");
    expect(await repo.resolve("fam-b")).toBe("fam-b");
    await expect(repo.add("fam-b", "fam-c", null, null)).rejects.toThrow();
  });
});
