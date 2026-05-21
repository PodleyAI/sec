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

describe("sec version CLI", () => {
  it("status shows the bootstrapped extractors after a fresh db setup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const status = await runCli(["version", "status", "--format", "json"], dir);
      expect(status.exitCode).toBe(0);
      const parsed = JSON.parse(status.stdout);
      // PR2 wires bootstrapExtractorVersions() into db setup; expect the
      // five extractor ids registered at 1.0.0 in the current slot.
      const ids = parsed
        .filter((r: { component_kind: string }) => r.component_kind === "extractor")
        .map((r: { component_id: string }) => r.component_id)
        .sort();
      expect(ids).toEqual(["1-A", "1-K", "1-Z", "C", "D"]);
      for (const row of parsed) {
        expect(row.current).toBe("1.0.0");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("seed-test populates a slot and status --format json reflects it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const seed = await runCli(
        ["version", "seed-test", "extractor", "D", "current", "1.0.0"],
        dir
      );
      expect(seed.exitCode).toBe(0);

      const status = await runCli(["version", "status", "--format", "json"], dir);
      expect(status.exitCode).toBe(0);
      const parsed = JSON.parse(status.stdout);
      // After PR2 bootstrap, status lists all five extractors; locate "D".
      const dRow = parsed.find(
        (r: { component_id: string }) => r.component_id === "D"
      );
      expect(dRow).toBeDefined();
      expect(dRow.current).toBe("1.0.0");
      expect(dRow.previous).toBe("—");
      expect(dRow.next).toBe("—");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("status --format json returns raw semver in next, with separate coverage flag", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const seed = await runCli(
        ["version", "seed-test", "extractor", "D", "next", "2.1.0"],
        dir
      );
      expect(seed.exitCode).toBe(0);

      const status = await runCli(["version", "status", "--format", "json"], dir);
      expect(status.exitCode).toBe(0);
      const parsed = JSON.parse(status.stdout);
      // After PR2 bootstrap, status lists all five extractors; locate "D".
      const dRow = parsed.find(
        (r: { component_id: string }) => r.component_id === "D"
      );
      expect(dRow).toBeDefined();
      // JSON output is raw data — semver only, no presentation suffix.
      expect(dRow.next).toBe("2.1.0");
      expect(dRow.next_coverage_complete).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("status rejects an unsupported --format value", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const status = await runCli(["version", "status", "--format", "yaml"], dir);
      expect(status.exitCode).not.toBe(0);
      expect(status.stderr + status.stdout).toMatch(/Invalid --format/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
