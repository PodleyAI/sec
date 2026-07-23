/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runCliProcess } from "../testing/runCliProcess";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { PersonResolver } from "../../resolver/PersonResolver";
import { CanonicalPersonAliasRepo } from "../../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalPersonRepo } from "../../storage/canonical/CanonicalPersonRepo";
import { PersonIdentityLinkRepo } from "../../storage/canonical/PersonIdentityLinkRepo";
import { PersonObservationRepo } from "../../storage/observation/PersonObservationRepo";

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

describe("resolve in-process with seeded data", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("resolves a seeded PersonObservation and writes an identity link", async () => {
    const RESOLVER_VERSION = "1.0.0";
    const obsRepo = new PersonObservationRepo();
    const linkRepo = new PersonIdentityLinkRepo();
    const canonRepo = new CanonicalPersonRepo();
    const aliasRepo = new CanonicalPersonAliasRepo();

    // Insert a test observation
    const obs = await obsRepo.upsertByNaturalKey({
      accession_number: "0001234567-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      source_filing_issuer_cik: 9999,
      normalized_first: "john",
      normalized_last: "doe",
      created_at: new Date().toISOString(),
    });

    // Run resolver
    const resolver = new PersonResolver({
      canonicalPersonRepo: canonRepo,
      canonicalPersonAliasRepo: aliasRepo,
      activeResolverVersion: RESOLVER_VERSION,
    });
    const canonical_person_id = await resolver.resolve(obs);
    expect(typeof canonical_person_id).toBe("string");
    expect(canonical_person_id.length).toBeGreaterThan(0);

    // Write identity link
    await linkRepo.upsert(obs.observation_id, RESOLVER_VERSION, canonical_person_id);

    // Assert link row was written
    const links = await linkRepo.listAll();
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].canonical_person_id).toBe(canonical_person_id);
    expect(links[0].resolver_version).toBe(RESOLVER_VERSION);
  });
});

describe("sec resolve CLI", () => {
  it("resolve --kind person --version 1.0.0 --all processes person observations", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-resolve-test-"));
    try {
      // Setup db
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      // Seed observations in-memory to the same db is complex via CLI; instead
      // we verify the command runs successfully on an empty DB (0 observations resolved)
      const result = await runCli(
        ["resolve", "--kind", "person", "--resolver-version", "1.0.0", "--all"],
        dir
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("resolved 0 person observation(s) at v1.0.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolve --kind company --version 1.0.0 --all processes company observations", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-resolve-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(
        ["resolve", "--kind", "company", "--resolver-version", "1.0.0", "--all"],
        dir
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("resolved 0 company observation(s) at v1.0.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolve is idempotent — running twice does not error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-resolve-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const r1 = await runCli(
        ["resolve", "--kind", "person", "--resolver-version", "1.0.0", "--all"],
        dir
      );
      expect(r1.exitCode).toBe(0);

      const r2 = await runCli(
        ["resolve", "--kind", "person", "--resolver-version", "1.0.0", "--all"],
        dir
      );
      expect(r2.exitCode).toBe(0);
      expect(r2.stdout).toBe(r1.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolve --kind invalid exits with error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-resolve-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(
        ["resolve", "--kind", "invalid", "--resolver-version", "1.0.0", "--all"],
        dir
      );
      expect(result.exitCode).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolve without --all exits with error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-resolve-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(
        ["resolve", "--kind", "person", "--resolver-version", "1.0.0"],
        dir
      );
      expect(result.exitCode).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolve rejects partial semver --resolver-version '1.0'", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-resolve-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(
        ["resolve", "--kind", "person", "--resolver-version", "1.0", "--all"],
        dir
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("--resolver-version");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolve rejects v-prefixed --resolver-version 'v1.0.0'", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-resolve-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(
        ["resolve", "--kind", "person", "--resolver-version", "v1.0.0", "--all"],
        dir
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("--resolver-version");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolve rejects nonsense --resolver-version 'not-a-version'", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-resolve-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(
        ["resolve", "--kind", "person", "--resolver-version", "not-a-version", "--all"],
        dir
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("--resolver-version");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
