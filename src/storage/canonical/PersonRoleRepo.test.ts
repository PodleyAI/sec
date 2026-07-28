/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
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
import { PersonRoleRepo, personRoleAssertionKey } from "./PersonRoleRepo";
import { PersonRolePrimaryKeyNames, PersonRoleSchema, type PersonRole } from "./PersonRoleSchema";

const BASE = {
  canonical_person_id: "person-1",
  resolver_version: "1.0.0",
  company_cik: 123,
  extractor_id: "D",
  role_scope: "form-d:related-person",
  title: "Director",
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

describe("PersonRoleRepo.recordAssertion", () => {
  let repo: PersonRoleRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  it("opens a tenure with a required start date on first sight", async () => {
    const role = await repo.recordAssertion({
      ...BASE,
      filing_date: "2023-01-01",
      accession_number: "A1",
    });
    expect(role.start_date).toBe("2023-01-01");
    expect(role.start_accession).toBe("A1");
    expect(role.end_date).toBeNull();
    expect(role.last_seen_date).toBe("2023-01-01");
    expect(role.normalized_title).toBe("director");
  });

  it("is idempotent for a replay of the same filing", async () => {
    await repo.recordAssertion({ ...BASE, filing_date: "2023-01-01", accession_number: "A1" });
    await repo.recordAssertion({ ...BASE, filing_date: "2023-01-01", accession_number: "A1" });
    const roles = await repo.listForPerson("person-1", "1.0.0");
    expect(roles).toHaveLength(1);
  });

  it("advances last_seen on a later assertion and extends start on an earlier one", async () => {
    await repo.recordAssertion({ ...BASE, filing_date: "2023-06-01", accession_number: "A2" });
    await repo.recordAssertion({ ...BASE, filing_date: "2024-01-01", accession_number: "A3" });
    await repo.recordAssertion({ ...BASE, filing_date: "2022-01-01", accession_number: "A1" });
    const roles = await repo.listForPerson("person-1", "1.0.0");
    expect(roles).toHaveLength(1);
    expect(roles[0].start_date).toBe("2022-01-01");
    expect(roles[0].start_accession).toBe("A1");
    expect(roles[0].last_seen_date).toBe("2024-01-01");
    expect(roles[0].last_seen_accession).toBe("A3");
  });

  it("matches titles case-insensitively but keeps distinct titles apart", async () => {
    await repo.recordAssertion({ ...BASE, filing_date: "2023-01-01", accession_number: "A1" });
    await repo.recordAssertion({
      ...BASE,
      title: "DIRECTOR",
      filing_date: "2023-06-01",
      accession_number: "A2",
    });
    await repo.recordAssertion({
      ...BASE,
      title: "Chief Executive Officer",
      filing_date: "2023-06-01",
      accession_number: "A2",
    });
    const roles = await repo.listForPerson("person-1", "1.0.0");
    expect(roles).toHaveLength(2);
  });

  it("keeps tenures apart per company, extractor, scope, and resolver version", async () => {
    await repo.recordAssertion({ ...BASE, filing_date: "2023-01-01", accession_number: "A1" });
    await repo.recordAssertion({
      ...BASE,
      company_cik: 456,
      filing_date: "2023-01-01",
      accession_number: "A1",
    });
    await repo.recordAssertion({
      ...BASE,
      resolver_version: "2.0.0",
      filing_date: "2023-01-01",
      accession_number: "A1",
    });
    expect(await repo.listForPerson("person-1", "1.0.0")).toHaveLength(2);
    expect(await repo.listForCompany(123, "1.0.0")).toHaveLength(1);
    expect(await repo.listForPerson("person-1", "2.0.0")).toHaveLength(1);
  });
});

describe("PersonRoleRepo.closeUnasserted", () => {
  let repo: PersonRoleRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  it("closes open roles absent from the roster, skipping asserted and other scopes", async () => {
    await repo.recordAssertion({ ...BASE, filing_date: "2023-01-01", accession_number: "A1" });
    await repo.recordAssertion({
      ...BASE,
      canonical_person_id: "person-2",
      title: "Executive Officer",
      filing_date: "2023-01-01",
      accession_number: "A1",
    });
    await repo.recordAssertion({
      ...BASE,
      role_scope: "form-d:signature",
      title: "Chief Executive Officer",
      filing_date: "2023-01-01",
      accession_number: "A1",
    });

    const closed = await repo.closeUnasserted({
      resolver_version: "1.0.0",
      company_cik: 123,
      extractor_id: "D",
      role_scope: "form-d:related-person",
      filing_date: "2024-01-01",
      accession_number: "A2",
      asserted: new Set([personRoleAssertionKey("person-2", "Executive Officer")]),
    });
    expect(closed).toBe(1);

    const p1 = await repo.listForPerson("person-1", "1.0.0");
    const director = p1.find((r) => r.title === "Director");
    expect(director?.end_date).toBe("2024-01-01");
    expect(director?.end_accession).toBe("A2");
    const p2 = await repo.listForPerson("person-2", "1.0.0");
    expect(p2[0].end_date).toBeNull();
    // The signature-scope role is a different population — untouched.
    const sig = (await repo.listForCompany(123, "1.0.0")).find(
      (r) => r.role_scope === "form-d:signature"
    );
    expect(sig?.end_date).toBeNull();
  });

  it("never closes on a same-day or older roster (strict guard)", async () => {
    await repo.recordAssertion({ ...BASE, filing_date: "2023-05-01", accession_number: "A1" });
    for (const filing_date of ["2023-05-01", "2023-01-01"]) {
      const closed = await repo.closeUnasserted({
        resolver_version: "1.0.0",
        company_cik: 123,
        extractor_id: "D",
        role_scope: "form-d:related-person",
        filing_date,
        accession_number: "AX",
        asserted: new Set(),
      });
      expect(closed).toBe(0);
    }
  });

  it("re-closing with the same roster is idempotent", async () => {
    await repo.recordAssertion({ ...BASE, filing_date: "2023-01-01", accession_number: "A1" });
    const args = {
      resolver_version: "1.0.0",
      company_cik: 123,
      extractor_id: "D",
      role_scope: "form-d:related-person",
      filing_date: "2024-01-01",
      accession_number: "A2",
      asserted: new Set<string>(),
    };
    expect(await repo.closeUnasserted(args)).toBe(1);
    expect(await repo.closeUnasserted(args)).toBe(0);
    const roles = await repo.listForPerson("person-1", "1.0.0");
    expect(roles).toHaveLength(1);
    expect(roles[0].end_date).toBe("2024-01-01");
  });
});

describe("PersonRoleRepo.closeUnasserted with alias merges", () => {
  it("does not close a retired-id tenure when the merged target is asserted", async () => {
    const aliasRepo = new CanonicalPersonAliasRepo({
      canonicalPersonAliasRepository: new InMemoryTabularStorage<
        typeof CanonicalPersonAliasSchema,
        typeof CanonicalPersonAliasPrimaryKeyNames,
        CanonicalPersonAlias
      >(CanonicalPersonAliasSchema, CanonicalPersonAliasPrimaryKeyNames, []),
    });
    const repo = new PersonRoleRepo({
      personRoleRepository: new InMemoryTabularStorage<
        typeof PersonRoleSchema,
        typeof PersonRolePrimaryKeyNames,
        PersonRole
      >(PersonRoleSchema, PersonRolePrimaryKeyNames, []),
      canonicalPersonAliasRepo: aliasRepo,
    });

    // Tenure opened under the id that later gets merged away.
    await repo.recordAssertion({
      ...BASE,
      canonical_person_id: "old-id",
      filing_date: "2023-01-01",
      accession_number: "A1",
    });
    await aliasRepo.add("old-id", "new-id", "merged duplicate", null);

    // Post-merge roster filing asserts the person under the target id only.
    const closed = await repo.closeUnasserted({
      resolver_version: "1.0.0",
      company_cik: 123,
      extractor_id: "D",
      role_scope: "form-d:related-person",
      filing_date: "2024-01-01",
      accession_number: "A2",
      asserted: new Set([personRoleAssertionKey("new-id", "Director")]),
    });
    expect(closed).toBe(0);
    const roles = await repo.listForPerson("old-id", "1.0.0");
    expect(roles[0].end_date).toBeNull();
  });
});

describe("PersonRoleRepo maintenance", () => {
  it("deleteForResolverVersion purges only that version's rows", async () => {
    const repo = makeRepo();
    await repo.recordAssertion({ ...BASE, filing_date: "2023-01-01", accession_number: "A1" });
    await repo.recordAssertion({
      ...BASE,
      resolver_version: "2.0.0",
      filing_date: "2023-01-01",
      accession_number: "A1",
    });
    expect(await repo.deleteForResolverVersion("1.0.0")).toBe(1);
    expect(await repo.listForPerson("person-1", "1.0.0")).toHaveLength(0);
    expect(await repo.listForPerson("person-1", "2.0.0")).toHaveLength(1);
  });
});
