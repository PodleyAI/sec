/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
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

/**
 * Spawn the CLI and wait until the version-gate warning is observed on
 * stdout/stderr, then kill the process. The warning is emitted
 * synchronously at the start of each action — well before any network
 * I/O — so we don't need a real run to complete. This keeps the test
 * fast and avoids depending on `--dry-run` flags that these commands
 * don't expose.
 */
async function spawnUntilWarning(
  args: string[],
  dbFolder: string,
  timeoutMs = 30_000
): Promise<{ output: string; sawWarning: boolean }> {
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

  const warningPattern = /--force no longer affects form processing/i;
  let combined = "";
  let sawWarning = false;

  const decoder = new TextDecoder();
  const readStream = async (stream: ReadableStream<Uint8Array> | null): Promise<void> => {
    if (!stream) return;
    const reader = stream.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        const chunk = decoder.decode(value, { stream: true });
        combined += chunk;
        if (!sawWarning && warningPattern.test(combined)) {
          sawWarning = true;
          proc.kill();
          return;
        }
      }
    } catch {
      // stream closed when we killed the process
    }
  };

  const timeoutHandle = setTimeout(() => {
    proc.kill();
  }, timeoutMs);

  await Promise.all([
    readStream(proc.stdout as unknown as ReadableStream<Uint8Array> | null),
    readStream(proc.stderr as unknown as ReadableStream<Uint8Array> | null),
    proc.exited,
  ]);
  clearTimeout(timeoutHandle);

  return { output: combined, sawWarning };
}

describe("--force warning on commands that no longer reprocess forms", () => {
  it("sync --force prints the version-gate warning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-force-warn-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

      const { output, sawWarning } = await spawnUntilWarning(["sync", "--force"], dir);
      expect(sawWarning).toBe(true);
      expect(output).toMatch(/--force no longer affects form processing/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("bootstrap --force prints the version-gate warning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-force-warn-"));
    try {
      const setup = await runCli(["db", "setup"], dir);
      expect(setup.exitCode).toBe(0);

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
