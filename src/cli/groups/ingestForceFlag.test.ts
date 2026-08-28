/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `bootstrap ingest --force` has to reach the task.
 *
 * The parent `bootstrap` command declares `--force` as well, and commander
 * attributes a flag shared with an ancestor to the ANCESTOR — so the
 * subcommand's own `options.force` stayed false however the flag was typed.
 * The failure was silent and expensive in exactly the wrong direction:
 * `BootstrapSubmissionsTask` answered a swallowed `--force` by taking the
 * unprocessed-only path, so a re-ingest meant to sweep ~1M cached CIKs
 * reported success after touching the handful the daily index had just added.
 * Nothing distinguished it from a real run but the count.
 *
 * Asserted through `--dry-run`, whose line names which path was taken
 * ("all" vs "unprocessed") — the one observable that tells them apart.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliEnv, runCliProcess } from "../testing/runCliProcess";

let dir = "";
let rawDir = "";

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return runCliProcess(
    ["bun", "src/sec.ts", ...args],
    cliEnv({
      SEC_DB_TYPE: "sqlite",
      SEC_DB_FOLDER: dir,
      SEC_DB_NAME: "edgar",
      SEC_RAW_DATA_FOLDER: rawDir,
    })
  );
}

describe("bootstrap ingest --force", () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sec-ingest-force-"));
    rawDir = mkdtempSync(join(tmpdir(), "sec-ingest-force-raw-"));
    mkdirSync(join(rawDir, "submissions"), { recursive: true });
    // Two CIK files is enough: the assertion is on which SET the task chose,
    // not on how many it found.
    for (const cik of ["CIK0000000003.json", "CIK0000000013.json"]) {
      writeFileSync(join(rawDir, "submissions", cik), "{}");
    }
    await runCli(["db", "setup"]);
  }, 120_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(rawDir, { recursive: true, force: true });
  });

  it("selects every CIK, not just the unprocessed ones", async () => {
    const { stdout, stderr } = await runCli([
      "--dry-run",
      "bootstrap",
      "ingest",
      "submissions",
      "--force",
    ]);
    expect(`${stdout}${stderr}`).toMatch(/Would bootstrap 2 all CIK submissions \(2 total\)/);
  }, 120_000);

  it("still selects only the unprocessed ones without the flag", async () => {
    const { stdout, stderr } = await runCli(["--dry-run", "bootstrap", "ingest", "submissions"]);
    expect(`${stdout}${stderr}`).toMatch(/Would bootstrap 2 unprocessed CIK submissions/);
  }, 120_000);
});
