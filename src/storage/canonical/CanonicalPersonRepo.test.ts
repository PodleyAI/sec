/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import { CanonicalPersonRepo } from "./CanonicalPersonRepo";
import {
  CanonicalPersonPrimaryKeyNames,
  CanonicalPersonSchema,
  type CanonicalPerson,
} from "./CanonicalPersonSchema";

function makeRow(overrides: Partial<CanonicalPerson> = {}): CanonicalPerson {
  return {
    canonical_person_id: "uuid-default",
    resolver_version: "1.0.0",
    display_first: null,
    display_middle: null,
    display_last: null,
    display_suffix: null,
    cik: null,
    normalized_first: null,
    normalized_middle: null,
    normalized_last: null,
    normalized_suffix: null,
    source_filing_issuer_cik: null,
    created_at: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("CanonicalPersonRepo", () => {
  let storage: InMemoryTabularStorage<
    typeof CanonicalPersonSchema,
    typeof CanonicalPersonPrimaryKeyNames,
    CanonicalPerson
  >;
  let repo: CanonicalPersonRepo;

  beforeEach(() => {
    storage = new InMemoryTabularStorage<
      typeof CanonicalPersonSchema,
      typeof CanonicalPersonPrimaryKeyNames,
      CanonicalPerson
    >(CanonicalPersonSchema, CanonicalPersonPrimaryKeyNames, [
      ["resolver_version", "cik"],
      ["resolver_version", "normalized_last"],
    ]);
    repo = new CanonicalPersonRepo({ canonicalPersonRepository: storage });
  });

  it("create + getById round-trips a row", async () => {
    const row = makeRow({ canonical_person_id: "uuid-1", cik: 1234 });
    await repo.create(row);
    const found = await repo.getById("uuid-1");
    expect(found?.cik).toBe(1234);
  });

  it("findByResolverAndCik scopes by resolver_version", async () => {
    await repo.create(
      makeRow({ canonical_person_id: "uuid-1", resolver_version: "1.0.0", cik: 1234 })
    );
    await repo.create(
      makeRow({ canonical_person_id: "uuid-2", resolver_version: "2.0.0", cik: 1234 })
    );

    expect((await repo.findByResolverAndCik("1.0.0", 1234))?.canonical_person_id).toBe("uuid-1");
    expect((await repo.findByResolverAndCik("2.0.0", 1234))?.canonical_person_id).toBe("uuid-2");
    expect(await repo.findByResolverAndCik("3.0.0", 1234)).toBeUndefined();
  });

  it("findByResolverAndCik returns undefined when no CIK match", async () => {
    await repo.create(makeRow({ canonical_person_id: "uuid-1", cik: 1234 }));
    expect(await repo.findByResolverAndCik("1.0.0", 9999)).toBeUndefined();
  });

  it("findByResolverAndName matches all five name dimensions plus issuer_cik", async () => {
    await repo.create(
      makeRow({
        canonical_person_id: "uuid-a",
        normalized_first: "jane",
        normalized_last: "doe",
        source_filing_issuer_cik: 100,
      })
    );
    await repo.create(
      makeRow({
        canonical_person_id: "uuid-b",
        normalized_first: "jane",
        normalized_last: "doe",
        source_filing_issuer_cik: 200,
      })
    );

    const a = await repo.findByResolverAndName("1.0.0", "jane", null, "doe", null, 100);
    expect(a?.canonical_person_id).toBe("uuid-a");
    const b = await repo.findByResolverAndName("1.0.0", "jane", null, "doe", null, 200);
    expect(b?.canonical_person_id).toBe("uuid-b");
    const c = await repo.findByResolverAndName("1.0.0", "jane", null, "doe", null, 300);
    expect(c).toBeUndefined();
  });

  it("listForResolverVersion returns only matching rows", async () => {
    await repo.create(makeRow({ canonical_person_id: "uuid-1", resolver_version: "1.0.0" }));
    await repo.create(makeRow({ canonical_person_id: "uuid-2", resolver_version: "1.0.0" }));
    await repo.create(makeRow({ canonical_person_id: "uuid-3", resolver_version: "2.0.0" }));

    const v1 = await repo.listForResolverVersion("1.0.0");
    expect(v1).toHaveLength(2);
    expect(v1.map((r) => r.canonical_person_id).sort()).toEqual(["uuid-1", "uuid-2"]);
  });

  it("deleteById removes the row", async () => {
    await repo.create(makeRow({ canonical_person_id: "uuid-1" }));
    await repo.deleteById("uuid-1");
    expect(await repo.getById("uuid-1")).toBeUndefined();
  });
});
