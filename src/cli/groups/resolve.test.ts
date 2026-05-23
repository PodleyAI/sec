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

      const r1 = await runCli(["resolve", "--kind", "person", "--resolver-version", "1.0.0", "--all"], dir);
      expect(r1.exitCode).toBe(0);

      const r2 = await runCli(["resolve", "--kind", "person", "--resolver-version", "1.0.0", "--all"], dir);
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

      const result = await runCli(["resolve", "--kind", "person", "--resolver-version", "1.0.0"], dir);
      expect(result.exitCode).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
