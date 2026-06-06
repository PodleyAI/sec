/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { CanonicalUnderwriterFamilyAliasRepo } from "./CanonicalUnderwriterFamilyAliasRepo";

describe("CanonicalUnderwriterFamilyAliasRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("resolves an alias to its target and rejects chains", async () => {
    const repo = new CanonicalUnderwriterFamilyAliasRepo();
    await repo.add("uw-a", "uw-b", "merge variant", "op");
    expect(await repo.resolve("uw-a")).toBe("uw-b");
    expect(await repo.resolve("uw-b")).toBe("uw-b");
    await expect(repo.add("uw-b", "uw-c", null, null)).rejects.toThrow();
  });

  it("lists variants by target", async () => {
    const repo = new CanonicalUnderwriterFamilyAliasRepo();
    await repo.add("uw-x1", "uw-x", null, null);
    await repo.add("uw-x2", "uw-x", null, null);
    const variants = (await repo.listByTarget("uw-x")).map((a) => a.alias_canonical_id).sort();
    expect(variants).toEqual(["uw-x1", "uw-x2"]);
  });
});
