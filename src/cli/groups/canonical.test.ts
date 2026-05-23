/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], dbFolder: string): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "src/sec.ts", ...args], {
    env: {
      ...process.env,
      SEC_DB_TYPE: "sqlite",
      SEC_DB_FOLDER: dbFolder,
      SEC_DB_NAME: "edgar",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  return {
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
    exitCode,
  };
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
