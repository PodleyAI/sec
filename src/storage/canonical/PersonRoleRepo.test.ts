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

describe("PersonRoleRepo out-of-order and re-extraction convergence", () => {
  let repo: PersonRoleRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  it("re-opening absorbs the interposed return tenure into one open row", async () => {
    // A1 opens; roster A2 (v1 missed the person) closes; A3 re-asserts (new
    // tenure); a v2 re-run of A2 now finds the person and undoes its closure.
    await repo.recordAssertion({ ...BASE, filing_date: "2023-01-01", accession_number: "A1" });
    await repo.closeUnasserted({
      resolver_version: "1.0.0",
      company_cik: 123,
      extractor_id: "D",
      role_scope: "form-d:related-person",
      filing_date: "2023-06-01",
      accession_number: "A2",
      asserted: new Set(),
    });
    await repo.recordAssertion({ ...BASE, filing_date: "2023-09-01", accession_number: "A3" });
    await repo.recordAssertion({ ...BASE, filing_date: "2023-06-01", accession_number: "A2" });

    const roles = await repo.listForPerson("person-1", "1.0.0");
    expect(roles).toHaveLength(1);
    expect(roles[0].start_date).toBe("2023-01-01");
    expect(roles[0].end_date).toBeNull();
    expect(roles[0].last_seen_date).toBe("2023-09-01");
  });

  it("a same-accession re-run that no longer asserts deletes its own phantom tenure", async () => {
    // v1 hallucinated the person; the tenure's only support is accession A1.
    await repo.recordAssertion({ ...BASE, filing_date: "2023-05-01", accession_number: "A1" });
    const closed = await repo.closeUnasserted({
      resolver_version: "1.0.0",
      company_cik: 123,
      extractor_id: "D",
      role_scope: "form-d:related-person",
      filing_date: "2023-05-01",
      accession_number: "A1",
      asserted: new Set(),
    });
    expect(closed).toBe(1);
    expect(await repo.listForPerson("person-1", "1.0.0")).toHaveLength(0);
  });

  it("a same-accession re-run closes (not deletes) a tenure other filings support", async () => {
    await repo.recordAssertion({ ...BASE, filing_date: "2023-01-01", accession_number: "A0" });
    await repo.recordAssertion({ ...BASE, filing_date: "2023-05-01", accession_number: "A1" });
    const closed = await repo.closeUnasserted({
      resolver_version: "1.0.0",
      company_cik: 123,
      extractor_id: "D",
      role_scope: "form-d:related-person",
      filing_date: "2023-05-01",
      accession_number: "A1",
      asserted: new Set(),
    });
    expect(closed).toBe(1);
    const roles = await repo.listForPerson("person-1", "1.0.0");
    expect(roles).toHaveLength(1);
    expect(roles[0].start_date).toBe("2023-01-01");
    expect(roles[0].end_date).toBe("2023-05-01");
  });

  it("an out-of-order earlier roster tightens end_date to the first non-asserting filing", async () => {
    await repo.recordAssertion({ ...BASE, filing_date: "2020-01-01", accession_number: "A1" });
    const close = (filing_date: string, accession_number: string) =>
      repo.closeUnasserted({
        resolver_version: "1.0.0",
        company_cik: 123,
        extractor_id: "D",
        role_scope: "form-d:related-person",
        filing_date,
        accession_number,
        asserted: new Set(),
      });
    await close("2021-01-01", "R2");
    await close("2020-06-01", "R1");
    const roles = await repo.listForPerson("person-1", "1.0.0");
    expect(roles[0].end_date).toBe("2020-06-01");
    expect(roles[0].end_accession).toBe("R1");
  });

  it("same-day sibling filings converge on open regardless of processing order", async () => {
    // Order 1: assertion (accession D) then roster (accession DA) — guard blocks.
    await repo.recordAssertion({ ...BASE, filing_date: "2020-01-01", accession_number: "A0" });
    await repo.recordAssertion({ ...BASE, filing_date: "2024-03-01", accession_number: "D" });
    await repo.closeUnasserted({
      resolver_version: "1.0.0",
      company_cik: 123,
      extractor_id: "D",
      role_scope: "form-d:related-person",
      filing_date: "2024-03-01",
      accession_number: "DA",
      asserted: new Set(),
    });
    expect((await repo.listForPerson("person-1", "1.0.0"))[0].end_date).toBeNull();

    // Order 2: roster first closes, then the same-day assertion re-opens (tie
    // goes to the assertion).
    const repo2 = makeRepo();
    await repo2.recordAssertion({ ...BASE, filing_date: "2020-01-01", accession_number: "A0" });
    await repo2.closeUnasserted({
      resolver_version: "1.0.0",
      company_cik: 123,
      extractor_id: "D",
      role_scope: "form-d:related-person",
      filing_date: "2024-03-01",
      accession_number: "DA",
      asserted: new Set(),
    });
    await repo2.recordAssertion({ ...BASE, filing_date: "2024-03-01", accession_number: "D" });
    const roles2 = await repo2.listForPerson("person-1", "1.0.0");
    expect(roles2).toHaveLength(1);
    expect(roles2[0].end_date).toBeNull();
  });

  it("an overlong title matches its own tenure instead of duplicating", async () => {
    const longTitle = "Senior Executive Vice President of " + "x".repeat(300);
    await repo.recordAssertion({
      ...BASE,
      title: longTitle,
      filing_date: "2023-01-01",
      accession_number: "A1",
    });
    await repo.recordAssertion({
      ...BASE,
      title: longTitle,
      filing_date: "2023-06-01",
      accession_number: "A2",
    });
    const roles = await repo.listForPerson("person-1", "1.0.0");
    expect(roles).toHaveLength(1);
    // Closure with the same overlong title in the asserted set must not close it.
    const closed = await repo.closeUnasserted({
      resolver_version: "1.0.0",
      company_cik: 123,
      extractor_id: "D",
      role_scope: "form-d:related-person",
      filing_date: "2024-01-01",
      accession_number: "A3",
      asserted: new Set([personRoleAssertionKey("person-1", longTitle)]),
    });
    expect(closed).toBe(0);
  });

  it("re-checks the assertion guard under the lock so a concurrent assertion wins", async () => {
    // Delay the alias resolve so the closure's pre-lock snapshot goes stale
    // while a newer filing's assertion lands.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slowAlias = {
      resolve: async (id: string) => {
        await gate;
        return id;
      },
    } as unknown as CanonicalPersonAliasRepo;
    const racy = new PersonRoleRepo({
      personRoleRepository: new InMemoryTabularStorage<
        typeof PersonRoleSchema,
        typeof PersonRolePrimaryKeyNames,
        PersonRole
      >(PersonRoleSchema, PersonRolePrimaryKeyNames, []),
      canonicalPersonAliasRepo: slowAlias,
    });
    await racy.recordAssertion({ ...BASE, filing_date: "2024-01-01", accession_number: "A1" });
    const closing = racy.closeUnasserted({
      resolver_version: "1.0.0",
      company_cik: 123,
      extractor_id: "D",
      role_scope: "form-d:related-person",
      filing_date: "2024-06-01",
      accession_number: "X",
      asserted: new Set(),
    });
    // While the closure is parked on the alias lookup, a NEWER filing asserts.
    await racy.recordAssertion({ ...BASE, filing_date: "2024-09-01", accession_number: "Y" });
    release();
    const closed = await closing;
    expect(closed).toBe(0);
    const roles = await racy.listForPerson("person-1", "1.0.0");
    expect(roles[0].end_date).toBeNull();
    expect(roles[0].last_seen_date).toBe("2024-09-01");
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

describe("PersonRoleRepo.deleteSoleSupport", () => {
  it("deletes only tenures both opened and last asserted by the reaped accession", async () => {
    const repo = makeRepo();
    // Sole support: opened and last seen by A1.
    await repo.recordAssertion({ ...BASE, filing_date: "2023-01-01", accession_number: "A1" });
    // Multi-support: opened by A1 but re-asserted by A2.
    await repo.recordAssertion({
      ...BASE,
      title: "Chief Executive Officer",
      filing_date: "2023-01-01",
      accession_number: "A1",
    });
    await repo.recordAssertion({
      ...BASE,
      title: "Chief Executive Officer",
      filing_date: "2023-06-01",
      accession_number: "A2",
    });

    const deleted = await repo.deleteSoleSupport({
      canonical_person_id: "person-1",
      resolver_version: "1.0.0",
      extractor_id: "D",
      accession_number: "A1",
    });
    expect(deleted).toBe(1);
    const roles = await repo.listForPerson("person-1", "1.0.0");
    expect(roles).toHaveLength(1);
    expect(roles[0].title).toBe("Chief Executive Officer");
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
