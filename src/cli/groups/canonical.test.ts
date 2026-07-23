/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { runCliProcess } from "../testing/runCliProcess";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTabularStorage } from "workglow";
import { CanonicalPersonRepo } from "../../storage/canonical/CanonicalPersonRepo";
import { CanonicalCompanyRepo } from "../../storage/canonical/CanonicalCompanyRepo";
import {
  CanonicalPersonSchema,
  CanonicalPersonPrimaryKeyNames,
  type CanonicalPerson,
} from "../../storage/canonical/CanonicalPersonSchema";
import {
  CanonicalCompanySchema,
  CanonicalCompanyPrimaryKeyNames,
  type CanonicalCompany,
} from "../../storage/canonical/CanonicalCompanySchema";
import {
  resolveCanonicalCompanyRef,
  resolveCanonicalPersonRef,
} from "./canonical";

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], dbFolder: string): Promise<RunResult> {
  return runCliProcess(["bun", "src/sec.ts", ...args], {
    ...process.env,
    SEC_DB_TYPE: "sqlite",
    SEC_DB_FOLDER: dbFolder,
    SEC_DB_NAME: "edgar",
  });
}

const UUID_A = "aaaaaaaa-0000-0000-0000-000000000001";
const UUID_B = "aaaaaaaa-0000-0000-0000-000000000002";

describe("sec canonical CLI", () => {
  it("person alias adds an alias successfully", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-canonical-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(
        ["canonical", "person", "alias", UUID_A, UUID_B, "--reason", "test merge"],
        dir
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("aliased");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("person alias rejects self-alias", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-canonical-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(
        ["canonical", "person", "alias", UUID_A, UUID_A],
        dir
      );
      expect(result.exitCode).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("person alias-list exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-canonical-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(["canonical", "person", "alias-list"], dir);
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("person alias-remove removes an alias", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-canonical-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      await runCli(["canonical", "person", "alias", UUID_A, UUID_B, "--reason", "test"], dir);

      const result = await runCli(["canonical", "person", "alias-remove", UUID_A], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("removed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("company alias adds an alias successfully", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-canonical-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(
        ["canonical", "company", "alias", UUID_A, UUID_B, "--reason", "test"],
        dir
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("aliased");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("company alias-list --orphans exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-canonical-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      // Add an alias first (UUID_A → UUID_B are not canonical rows, so they'll be orphans)
      await runCli(
        ["canonical", "company", "alias", UUID_A, UUID_B, "--reason", "test"],
        dir
      );

      const result = await runCli(["canonical", "company", "alias-list", "--orphans"], dir);
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("person alias-list --orphans exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-canonical-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(["canonical", "person", "alias-list", "--orphans"], dir);
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Direct unit tests for the canonical-reference resolver helpers. The CLI docs
// invite operators to pass display names; we must not let those flow straight
// into UUID-typed columns. See S-MAIN-03.
describe("resolveCanonicalPersonRef", () => {
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
    >(CanonicalPersonSchema, CanonicalPersonPrimaryKeyNames, []);
    repo = new CanonicalPersonRepo({ canonicalPersonRepository: storage });
  });

  it("returns a UUID input unchanged (round-trip)", async () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(await resolveCanonicalPersonRef(id, repo)).toBe(id);
  });

  it("resolves a bare name to its UUID", async () => {
    const id = "aaaaaaaa-0000-0000-0000-000000000001";
    await repo.create({
      canonical_person_id: id,
      resolver_version: "1.0.0",
      display_first: "Jane",
      display_middle: null,
      display_last: "Doe",
      display_suffix: null,
      cik: null,
      normalized_first: "jane",
      normalized_middle: null,
      normalized_last: "doe",
      normalized_suffix: null,
      source_filing_issuer_cik: null,
      created_at: "2026-05-22T00:00:00.000Z",
    });
    expect(await resolveCanonicalPersonRef("Jane Doe", repo)).toBe(id);
    // last-only and case-insensitive matches also work
    expect(await resolveCanonicalPersonRef("doe", repo)).toBe(id);
  });

  it("throws on ambiguous bare name (multiple matches)", async () => {
    await repo.create({
      canonical_person_id: "aaaaaaaa-0000-0000-0000-000000000001",
      resolver_version: "1.0.0",
      display_first: null,
      display_middle: null,
      display_last: "Smith",
      display_suffix: null,
      cik: null,
      normalized_first: null,
      normalized_middle: null,
      normalized_last: "smith",
      normalized_suffix: null,
      source_filing_issuer_cik: 100,
      created_at: "2026-05-22T00:00:00.000Z",
    });
    await repo.create({
      canonical_person_id: "aaaaaaaa-0000-0000-0000-000000000002",
      resolver_version: "1.0.0",
      display_first: null,
      display_middle: null,
      display_last: "Smith",
      display_suffix: null,
      cik: null,
      normalized_first: null,
      normalized_middle: null,
      normalized_last: "smith",
      normalized_suffix: null,
      source_filing_issuer_cik: 200,
      created_at: "2026-05-22T00:00:00.000Z",
    });
    await expect(resolveCanonicalPersonRef("Smith", repo)).rejects.toThrow(/multiple/);
  });

  it("throws when no canonical person matches a bare name", async () => {
    await expect(resolveCanonicalPersonRef("Nobody Here", repo)).rejects.toThrow(/no canonical/);
  });

  it("trims leading/trailing whitespace before UUID and name matching", async () => {
    const id = "aaaaaaaa-0000-0000-0000-000000000001";
    await repo.create({
      canonical_person_id: id,
      resolver_version: "1.0.0",
      display_first: "Jane",
      display_middle: null,
      display_last: "Doe",
      display_suffix: null,
      cik: null,
      normalized_first: "jane",
      normalized_middle: null,
      normalized_last: "doe",
      normalized_suffix: null,
      source_filing_issuer_cik: null,
      created_at: "2026-05-22T00:00:00.000Z",
    });
    // UUID with surrounding whitespace still detected as UUID.
    expect(await resolveCanonicalPersonRef(` ${id}\n`, repo)).toBe(id);
    // Bare name with trailing whitespace still resolves to its UUID.
    expect(await resolveCanonicalPersonRef("Jane Doe ", repo)).toBe(id);
    expect(await resolveCanonicalPersonRef(" doe\t", repo)).toBe(id);
  });
});

describe("resolveCanonicalCompanyRef", () => {
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
    >(CanonicalCompanySchema, CanonicalCompanyPrimaryKeyNames, []);
    repo = new CanonicalCompanyRepo({ canonicalCompanyRepository: storage });
  });

  it("returns a UUID input unchanged (round-trip)", async () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(await resolveCanonicalCompanyRef(id, repo)).toBe(id);
  });

  it("resolves a bare name to its UUID", async () => {
    const id = "bbbbbbbb-0000-0000-0000-000000000001";
    await repo.create({
      canonical_company_id: id,
      resolver_version: "1.0.0",
      display_name: "Acme Holdings LLC",
      cik: null,
      crd_number: null,
      normalized_name: "acme holdings llc",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    expect(await resolveCanonicalCompanyRef("acme holdings llc", repo)).toBe(id);
    expect(await resolveCanonicalCompanyRef("Acme Holdings LLC", repo)).toBe(id);
  });

  it("throws on ambiguous bare name (multiple matches)", async () => {
    await repo.create({
      canonical_company_id: "bbbbbbbb-0000-0000-0000-000000000001",
      resolver_version: "1.0.0",
      display_name: "Globex",
      cik: null,
      crd_number: null,
      normalized_name: "globex",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    await repo.create({
      canonical_company_id: "bbbbbbbb-0000-0000-0000-000000000002",
      resolver_version: "2.0.0",
      display_name: "Globex",
      cik: null,
      crd_number: null,
      normalized_name: "globex",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    await expect(resolveCanonicalCompanyRef("Globex", repo)).rejects.toThrow(/multiple/);
  });

  it("throws when no canonical company matches a bare name", async () => {
    await expect(resolveCanonicalCompanyRef("Nonexistent Co", repo)).rejects.toThrow(
      /no canonical/
    );
  });

  it("trims leading/trailing whitespace before UUID and name matching", async () => {
    const id = "bbbbbbbb-0000-0000-0000-000000000001";
    await repo.create({
      canonical_company_id: id,
      resolver_version: "1.0.0",
      display_name: "Acme Holdings LLC",
      cik: null,
      crd_number: null,
      normalized_name: "acme holdings llc",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    expect(await resolveCanonicalCompanyRef(` ${id}\n`, repo)).toBe(id);
    expect(await resolveCanonicalCompanyRef("Acme Holdings LLC ", repo)).toBe(id);
    expect(await resolveCanonicalCompanyRef(" acme holdings llc\t", repo)).toBe(id);
  });
});
