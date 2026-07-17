/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
      // db setup bootstraps extractor versions; expect every
      // extractor id registered at 1.0.0 in the current slot.
      const ids = parsed
        .filter((r: { component_kind: string }) => r.component_kind === "extractor")
        .map((r: { component_id: string }) => r.component_id)
        .sort();
      expect(ids).toEqual([
        "1-A",
        "1-K",
        "1-Z",
        "144",
        "3",
        "4",
        "424",
        "5",
        "8-K",
        "C",
        "CFPORTAL",
        "D",
        "S-1",
        "loi",
        "merger-proxy",
        "redemption",
      ]);
      const extractorRows = parsed.filter(
        (r: { component_kind: string }) => r.component_kind === "extractor"
      );
      for (const row of extractorRows) {
        expect(row.current).toBe("1.0.0");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("status --format json returns raw semver in next, with separate coverage flag", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const startDev = await runCli(
        ["version", "start-dev", "extractor", "D", "2.0.0", "--bump", "major"],
        dir
      );
      expect(startDev.exitCode).toBe(0);

      const status = await runCli(["version", "status", "--format", "json"], dir);
      expect(status.exitCode).toBe(0);
      const parsed = JSON.parse(status.stdout);
      // After bootstrap, status lists all extractors; locate "D".
      const dRow = parsed.find((r: { component_id: string }) => r.component_id === "D");
      expect(dRow).toBeDefined();
      // JSON output is raw data — semver only, no presentation suffix.
      expect(dRow.next).toBe("2.0.0");
      expect(dRow.next_coverage_complete).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

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

  it("start-dev creates a next slot and history records it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(
        [
          "version",
          "start-dev",
          "extractor",
          "D",
          "2.0.0",
          "--bump",
          "major",
          "--notes",
          "first dev cycle",
        ],
        dir
      );
      expect(result.exitCode).toBe(0);

      const status = await runCli(["version", "status", "--format", "json"], dir);
      expect(status.exitCode).toBe(0);
      const parsed = JSON.parse(status.stdout);
      const dRow = parsed.find((r: { component_id: string }) => r.component_id === "D");
      expect(dRow?.next).toBe("2.0.0");
      expect(dRow?.next_coverage_complete).toBe(false);

      const history = await runCli(
        ["version", "history", "extractor", "D", "--format", "json"],
        dir
      );
      expect(history.exitCode).toBe(0);
      const events = JSON.parse(history.stdout);
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe("start-dev");
      expect(events[0].notes).toBe("first dev cycle");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  it("coverage reports in-progress with a known denominator", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      await runCli(["db", "setup"], dir);
      await runCli(["version", "start-dev", "extractor", "D", "2.0.0", "--bump", "major"], dir);
      const result = await runCli(
        ["version", "coverage", "extractor", "D", "--format", "json"],
        dir
      );
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.next_semver).toBe("2.0.0");
      expect(parsed.target_count).toBe(0); // no filings seeded
      expect(parsed.status).toMatch(/ready to promote/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  it("promote with --force rotates slots and history records both events", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      await runCli(["db", "setup"], dir);
      await runCli(["version", "start-dev", "extractor", "D", "2.0.0", "--bump", "major"], dir);
      const promote = await runCli(["version", "promote", "extractor", "D", "--force"], dir);
      expect(promote.exitCode).toBe(0);

      const status = await runCli(["version", "status", "--format", "json"], dir);
      const parsed = JSON.parse(status.stdout);
      const dRow = parsed.find((r: { component_id: string }) => r.component_id === "D");
      expect(dRow?.current).toBe("2.0.0");
      expect(dRow?.previous).toBe("1.0.0");
      expect(dRow?.next).toBe("—");

      const history = await runCli(
        ["version", "history", "extractor", "D", "--format", "json"],
        dir
      );
      const events = JSON.parse(history.stdout);
      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe("promote");
      expect(events[1].event_type).toBe("start-dev");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  it("rollback swaps current and previous", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      await runCli(["db", "setup"], dir);
      await runCli(["version", "start-dev", "extractor", "D", "2.0.0", "--bump", "major"], dir);
      await runCli(["version", "promote", "extractor", "D", "--force"], dir);

      const result = await runCli(["version", "rollback", "extractor", "D"], dir);
      expect(result.exitCode).toBe(0);

      const status = await runCli(["version", "status", "--format", "json"], dir);
      const parsed = JSON.parse(status.stdout);
      const dRow = parsed.find((r: { component_id: string }) => r.component_id === "D");
      expect(dRow?.current).toBe("1.0.0");
      expect(dRow?.previous).toBe("2.0.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  it("drop-next clears the next slot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      await runCli(["db", "setup"], dir);
      await runCli(["version", "start-dev", "extractor", "D", "2.0.0", "--bump", "major"], dir);
      const result = await runCli(["version", "drop-next", "extractor", "D"], dir);
      expect(result.exitCode).toBe(0);

      const status = await runCli(["version", "status", "--format", "json"], dir);
      const parsed = JSON.parse(status.stdout);
      const dRow = parsed.find((r: { component_id: string }) => r.component_id === "D");
      expect(dRow?.next).toBe("—");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  it("start-dev --bump patch updates current in place without a next slot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      await runCli(["db", "setup"], dir);
      const result = await runCli(
        ["version", "start-dev", "extractor", "D", "1.0.1", "--bump", "patch"],
        dir
      );
      expect(result.exitCode).toBe(0);

      const status = await runCli(["version", "status", "--format", "json"], dir);
      const parsed = JSON.parse(status.stdout);
      const dRow = parsed.find((r: { component_id: string }) => r.component_id === "D");
      expect(dRow?.current).toBe("1.0.1");
      expect(dRow?.next).toBe("—");
      expect(dRow?.previous).toBe("—");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  it("coverage resolver person shows coverage fraction", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const result = await runCli(["version", "coverage", "resolver", "person"], dir);
      expect(result.exitCode).toBe(0);
      // Output: "resolver:person@1.0.0: 0/0 (0.0%)" — no observations seeded
      expect(result.stdout).toContain("resolver:person@");
      expect(result.stdout).toContain("0/0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects start-dev for an unknown extractor id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-version-test-"));
    try {
      await runCli(["db", "setup"], dir);
      const result = await runCli(
        ["version", "start-dev", "extractor", "no-such-form", "1.0.0", "--bump", "major"],
        dir
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/no extractor registered/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
