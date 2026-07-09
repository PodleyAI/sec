/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import {
  CanonicalPersonAliasPrimaryKeyNames,
  CanonicalPersonAliasSchema,
  type CanonicalPersonAlias,
} from "./CanonicalAliasSchemas";
import { CanonicalPersonAliasRepo } from "./CanonicalPersonAliasRepo";

describe("CanonicalPersonAliasRepo", () => {
  let storage: InMemoryTabularStorage<
    typeof CanonicalPersonAliasSchema,
    typeof CanonicalPersonAliasPrimaryKeyNames,
    CanonicalPersonAlias
  >;
  let repo: CanonicalPersonAliasRepo;

  beforeEach(() => {
    storage = new InMemoryTabularStorage<
      typeof CanonicalPersonAliasSchema,
      typeof CanonicalPersonAliasPrimaryKeyNames,
      CanonicalPersonAlias
    >(CanonicalPersonAliasSchema, CanonicalPersonAliasPrimaryKeyNames, []);
    repo = new CanonicalPersonAliasRepo({ canonicalPersonAliasRepository: storage });
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

  it("add rejects when from-id is already a target (no 2-hop chains)", async () => {
    // Establish A → B. Now B is a target.
    await repo.add("uuid-a", "uuid-b", null, "op");
    // Attempting B → C must fail; otherwise resolve("uuid-a") would yield
    // the stale "uuid-b" since resolve() is single-hop by design.
    await expect(repo.add("uuid-b", "uuid-c", null, "op")).rejects.toThrow(/single-hop/);
  });

  it("remove deletes the row; resolve falls back to identity afterwards", async () => {
    await repo.add("uuid-a", "uuid-b", null, "op");
    await repo.remove("uuid-a");
    expect(await repo.resolve("uuid-a")).toBe("uuid-a");
  });
});
