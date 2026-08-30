/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import { PersonRoleRepo } from "./PersonRoleRepo";
import { PersonRolePrimaryKeyNames, PersonRoleSchema, type PersonRole } from "./PersonRoleSchema";

const BASE = {
  canonical_person_id: "person-1",
  resolver_version: "1.0.0",
  company_cik: 123,
  extractor_id: "D",
  role_scope: "form-d:related-person",
  title: "Director",
  normalized_title: "director",
  start_date: "2023-01-01",
  start_accession: "A1",
  end_date: null,
  end_accession: null,
  last_seen_date: "2023-01-01",
  last_seen_accession: "A1",
} as const;

function makeRepo(): PersonRoleRepo {
  return new PersonRoleRepo({
    personRoleRepository: new InMemoryTabularStorage<
      typeof PersonRoleSchema,
      typeof PersonRolePrimaryKeyNames,
      PersonRole
    >(PersonRoleSchema, PersonRolePrimaryKeyNames, []),
  });
}

describe("PersonRoleRepo maintenance", () => {
  it("deleteForResolverVersion purges only that version's rows", async () => {
    const repo = makeRepo();
    await repo.insertTenure({ ...BASE });
    await repo.insertTenure({ ...BASE, resolver_version: "2.0.0" });
    expect(await repo.deleteForResolverVersion("1.0.0")).toBe(1);
    expect(await repo.listForPerson("person-1", "1.0.0")).toHaveLength(0);
    expect(await repo.listForPerson("person-1", "2.0.0")).toHaveLength(1);
  });
});
