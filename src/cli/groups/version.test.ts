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
  it("status prints empty message when no components are registered", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const status = await runCli(["version", "status"], dir);
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain("No components registered");
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
      expect(parsed).toHaveLength(1);
      expect(parsed[0].component_id).toBe("D");
      expect(parsed[0].current).toBe("1.0.0");
      expect(parsed[0].previous).toBe("—");
      expect(parsed[0].next).toBe("—");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
