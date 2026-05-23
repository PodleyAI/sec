/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { InMemoryTabularStorage } from "workglow";
import { CanonicalCompanyAliasRepo } from "./CanonicalCompanyAliasRepo";
import {
  CanonicalCompanyAliasSchema,
  CanonicalCompanyAliasPrimaryKeyNames,
  type CanonicalCompanyAlias,
} from "./CanonicalAliasSchemas";

describe("CanonicalCompanyAliasRepo", () => {
  let storage: InMemoryTabularStorage<
    typeof CanonicalCompanyAliasSchema,
    typeof CanonicalCompanyAliasPrimaryKeyNames,
    CanonicalCompanyAlias
  >;
  let repo: CanonicalCompanyAliasRepo;

  beforeEach(() => {
    storage = new InMemoryTabularStorage<
      typeof CanonicalCompanyAliasSchema,
      typeof CanonicalCompanyAliasPrimaryKeyNames,
      CanonicalCompanyAlias
    >(CanonicalCompanyAliasSchema, CanonicalCompanyAliasPrimaryKeyNames, []);
    repo = new CanonicalCompanyAliasRepo({ canonicalCompanyAliasRepository: storage });
  });

  it("resolve returns the canonical id itself when no alias exists", async () => {
    expect(await repo.resolve("uuid-a")).toBe("uuid-a");
  });

  it("resolve returns target when an alias is present", async () => {
    await repo.add("uuid-a", "uuid-b", "merged duplicate", "operator-1");
    expect(await repo.resolve("uuid-a")).toBe("uuid-b");
  });

  it("add rejects when target is itself an alias source (single-hop invariant)", async () => {
    await repo.add("uuid-a", "uuid-b", null, "op");
    await expect(repo.add("uuid-c", "uuid-a", null, "op")).rejects.toThrow(/single-hop/);
  });

  it("add rejects self-alias", async () => {
    await expect(repo.add("uuid-x", "uuid-x", null, "op")).rejects.toThrow(/self/);
  });

  it("remove deletes the row; resolve falls back to identity afterwards", async () => {
    await repo.add("uuid-a", "uuid-b", null, "op");
    await repo.remove("uuid-a");
    expect(await repo.resolve("uuid-a")).toBe("uuid-a");
  });
});
