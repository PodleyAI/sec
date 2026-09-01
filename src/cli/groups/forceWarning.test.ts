/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BootstrappedDbTemplate } from "../testing/bootstrappedDbTemplate";
import { bootstrapDbTemplate } from "../testing/bootstrappedDbTemplate";
import { cliEnv } from "../testing/runCliProcess";

/**
 * Spawn the CLI and wait until the version-gate warning is observed on
 * stdout/stderr, then kill the process. The warning is emitted
 * synchronously at the start of each action — well before any network
 * I/O — so we don't need a real run to complete. This keeps the test
 * fast and avoids depending on `--dry-run` flags that these commands
 * don't expose.
 */
function spawnUntilWarning(
  args: string[],
  dbFolder: string,
  timeoutMs = 30_000
): Promise<{ output: string; sawWarning: boolean }> {
  return new Promise((resolve) => {
    const proc = spawn("bun", ["src/sec.ts", ...args], {
      env: cliEnv({
        SEC_DB_TYPE: "sqlite",
        SEC_DB_FOLDER: dbFolder,
        SEC_DB_NAME: "edgar",
      }),
    });

    const warningPattern = /--force no longer affects form processing/i;
    let combined = "";
    let sawWarning = false;
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      try {
        proc.kill();
      } catch {
        // already exited
      }
      resolve({ output: combined, sawWarning });
    };

    const onData = (chunk: Buffer): void => {
      combined += chunk.toString();
      if (!sawWarning && warningPattern.test(combined)) {
        sawWarning = true;
        finish();
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    // Same cast as `runCliProcess`: `ChildProcessWithoutNullStreams` is missing
    // EventEmitter's methods under this tsconfig (TypeScript 6 + DOM +
    // @types/bun), while the events themselves are unchanged.
    const events = proc as unknown as NodeJS.EventEmitter;
    events.on("close", finish);
    events.on("error", finish);

    const timeoutHandle = setTimeout(finish, timeoutMs);
  });
}

describe("--force warning on commands that no longer reprocess forms", () => {
  let template: BootstrappedDbTemplate;

  beforeAll(async () => {
    template = await bootstrapDbTemplate("sec-force-warn-");
  }, 30000);

  afterAll(() => {
    template?.dispose();
  });

  it("sync all --force prints the version-gate warning", async () => {
    const dir = template.materialize();
    try {
      // Bare `sync` is a command group (help only). `--force` on `all` still
      // reprocesses submissions/facts watermarks, not forms.
      const { output, sawWarning } = await spawnUntilWarning(["sync", "all", "--force"], dir);
      expect(sawWarning).toBe(true);
      expect(output).toMatch(/--force no longer affects form processing/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("bootstrap --force prints the version-gate warning", async () => {
    const dir = template.materialize();
    try {
      // Skip every real workload — only the synchronous warning needs to fire.
      const { output, sawWarning } = await spawnUntilWarning(
        ["bootstrap", "--force", "--skip-download", "--skip-ingest", "--skip-forms"],
        dir
      );
      expect(sawWarning).toBe(true);
      expect(output).toMatch(/--force no longer affects form processing/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
