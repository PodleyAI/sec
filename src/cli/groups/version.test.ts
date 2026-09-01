/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BootstrappedDbTemplate } from "../testing/bootstrappedDbTemplate";
import { bootstrapDbTemplate } from "../testing/bootstrappedDbTemplate";
import { cliEnv, runCliProcess } from "../testing/runCliProcess";

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], dbFolder: string): Promise<RunResult> {
  return runCliProcess(
    ["bun", "src/sec.ts", ...args],
    cliEnv({
      SEC_DB_TYPE: "sqlite",
      SEC_DB_FOLDER: dbFolder,
      SEC_DB_NAME: "edgar",
    })
  );
}

describe("sec version CLI", () => {
  /** Straight out of `db setup`. */
  let bootstrapped: BootstrappedDbTemplate;
  /**
   * `db setup` plus a major start-dev on D, so D has a next slot at 2.0.0.
   * Tests whose subject is promote/rollback/drop-next start here instead of
   * spending a process re-running the ceremony that gets them there — what
   * start-dev itself does is asserted below, and in `ceremonies.test.ts`.
   */
  let withNextSlot: BootstrappedDbTemplate;

  beforeAll(async () => {
    bootstrapped = await bootstrapDbTemplate("sec-version-test-");
    withNextSlot = await bootstrapped.derive("sec-version-next-", [
      ["version", "start-dev", "extractor", "D", "2.0.0", "--bump", "major"],
    ]);
  }, 60000);

  afterAll(() => {
    withNextSlot?.dispose();
    bootstrapped?.dispose();
  });

  it("status shows the bootstrapped extractors after a fresh db setup", async () => {
    const dir = bootstrapped.materialize();
    try {
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
        "1-A-W",
        "1-K",
        "1-U",
        "1-Z",
        "144",
        "25-15",
        "253G",
        "3",
        "4",
        "424",
        "424-xbrl",
        "5",
        "8-K",
        "8-K-items",
        "C",
        "CFPORTAL",
        "D",
        "QUALIF",
        "RW",
        "S-1",
        "S-1-xbrl",
        "loi",
        "merger-proxy",
        "redemption",
        "rega-financials-1sa",
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
    const dir = withNextSlot.materialize();
    try {
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
    const dir = bootstrapped.materialize();
    try {
      const status = await runCli(["version", "status", "--format", "yaml"], dir);
      expect(status.exitCode).not.toBe(0);
      expect(status.stderr + status.stdout).toMatch(/Invalid --format/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("start-dev creates a next slot and history records it", async () => {
    const dir = bootstrapped.materialize();
    try {
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
    const dir = withNextSlot.materialize();
    try {
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
    const dir = withNextSlot.materialize();
    try {
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
    const dir = withNextSlot.materialize();
    try {
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
    const dir = withNextSlot.materialize();
    try {
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
    const dir = bootstrapped.materialize();
    try {
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

  it("rejects start-dev for an unknown extractor id", async () => {
    const dir = bootstrapped.materialize();
    try {
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
