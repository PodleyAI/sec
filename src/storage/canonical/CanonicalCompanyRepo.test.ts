/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { InMemoryTabularStorage } from "workglow";
import { CanonicalCompanyRepo } from "./CanonicalCompanyRepo";
import {
  CanonicalCompanyPrimaryKeyNames,
  CanonicalCompanySchema,
  type CanonicalCompany,
} from "./CanonicalCompanySchema";

function makeRow(overrides: Partial<CanonicalCompany> = {}): CanonicalCompany {
  return {
    canonical_company_id: "uuid-default",
    resolver_version: "1.0.0",
    display_name: null,
    cik: null,
    crd_number: null,
    normalized_name: null,
    created_at: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("CanonicalCompanyRepo", () => {
  let storage: InMemoryTabularStorage<
    typeof CanonicalCompanySchema,
    typeof CanonicalCompanyPrimaryKeyNames,
    CanonicalCompany
  >;
  let repo: CanonicalCompanyRepo;

  beforeEach(() => {
    storage = new InMemoryTabularStorage<
      typeof CanonicalCompanySchema,
      typeof CanonicalCompanyPrimaryKeyNames,
      CanonicalCompany
    >(CanonicalCompanySchema, CanonicalCompanyPrimaryKeyNames, [
      ["resolver_version", "cik"],
      ["resolver_version", "crd_number"],
      ["resolver_version", "normalized_name"],
    ]);
    repo = new CanonicalCompanyRepo({ canonicalCompanyRepository: storage });
  });

  it("create + getById round-trips a row", async () => {
    const row = makeRow({ canonical_company_id: "uuid-1", cik: 1234 });
    await repo.create(row);
    const found = await repo.getById("uuid-1");
    expect(found?.cik).toBe(1234);
  });

  it("findByResolverAndCik scopes by resolver_version", async () => {
    await repo.create(makeRow({ canonical_company_id: "uuid-1", resolver_version: "1.0.0", cik: 1234 }));
    await repo.create(makeRow({ canonical_company_id: "uuid-2", resolver_version: "2.0.0", cik: 1234 }));

    expect((await repo.findByResolverAndCik("1.0.0", 1234))?.canonical_company_id).toBe("uuid-1");
    expect((await repo.findByResolverAndCik("2.0.0", 1234))?.canonical_company_id).toBe("uuid-2");
    expect(await repo.findByResolverAndCik("3.0.0", 1234)).toBeUndefined();
  });

  it("findByResolverAndCrd scopes by resolver_version", async () => {
    await repo.create(makeRow({ canonical_company_id: "uuid-1", resolver_version: "1.0.0", crd_number: "CRD-001" }));
    await repo.create(makeRow({ canonical_company_id: "uuid-2", resolver_version: "2.0.0", crd_number: "CRD-001" }));

    expect((await repo.findByResolverAndCrd("1.0.0", "CRD-001"))?.canonical_company_id).toBe("uuid-1");
    expect((await repo.findByResolverAndCrd("2.0.0", "CRD-001"))?.canonical_company_id).toBe("uuid-2");
    expect(await repo.findByResolverAndCrd("3.0.0", "CRD-001")).toBeUndefined();
  });

  it("findByResolverAndName scopes by resolver_version", async () => {
    await repo.create(makeRow({ canonical_company_id: "uuid-1", resolver_version: "1.0.0", normalized_name: "acme corp" }));
    await repo.create(makeRow({ canonical_company_id: "uuid-2", resolver_version: "2.0.0", normalized_name: "acme corp" }));

    expect((await repo.findByResolverAndName("1.0.0", "acme corp"))?.canonical_company_id).toBe("uuid-1");
    expect((await repo.findByResolverAndName("2.0.0", "acme corp"))?.canonical_company_id).toBe("uuid-2");
    expect(await repo.findByResolverAndName("3.0.0", "acme corp")).toBeUndefined();
  });

  it("listForResolverVersion returns only matching rows", async () => {
    await repo.create(makeRow({ canonical_company_id: "uuid-1", resolver_version: "1.0.0" }));
    await repo.create(makeRow({ canonical_company_id: "uuid-2", resolver_version: "1.0.0" }));
    await repo.create(makeRow({ canonical_company_id: "uuid-3", resolver_version: "2.0.0" }));

    const v1 = await repo.listForResolverVersion("1.0.0");
    expect(v1).toHaveLength(2);
    expect(v1.map((r) => r.canonical_company_id).sort()).toEqual(["uuid-1", "uuid-2"]);
  });

  it("deleteById removes the row", async () => {
    await repo.create(makeRow({ canonical_company_id: "uuid-1" }));
    await repo.deleteById("uuid-1");
    expect(await repo.getById("uuid-1")).toBeUndefined();
  });

  it("listAll returns all rows across resolver versions", async () => {
    await repo.create(makeRow({ canonical_company_id: "uuid-1", resolver_version: "1.0.0" }));
    await repo.create(makeRow({ canonical_company_id: "uuid-2", resolver_version: "2.0.0" }));

    const all = await repo.listAll();
    expect(all).toHaveLength(2);
  });
});
