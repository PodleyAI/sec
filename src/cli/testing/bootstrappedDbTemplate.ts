/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliEnv, runCliProcess } from "./runCliProcess";

const DB_NAME = "edgar";

export interface BootstrappedDbTemplate {
  /**
   * A fresh database folder holding its own copy of the bootstrap, for one
   * test to mutate. The caller removes it.
   */
  materialize(): string;
  /** Removes the template itself. */
  dispose(): void;
}

/**
 * One `db setup`, copied per test instead of re-run per test.
 *
 * `db setup` costs a whole CLI process — the work is boot, not the DDL, since a
 * read-only command on an existing database costs the same — and every run
 * produces the identical bootstrap. A file that paid it per test spent most of
 * its runtime rebuilding one fixture.
 *
 * Copies every `edgar.sqlite*` file rather than the main database alone: with
 * WAL journaling the committed contents can still be sitting in the `-wal`, so
 * copying `edgar.sqlite` on its own yields a database that opens cleanly and is
 * missing its tables.
 */
export async function bootstrapDbTemplate(prefix: string): Promise<BootstrappedDbTemplate> {
  const templateDir = mkdtempSync(join(tmpdir(), `${prefix}template-`));
  const setup = await runCliProcess(
    ["bun", "src/sec.ts", "db", "setup"],
    cliEnv({ SEC_DB_TYPE: "sqlite", SEC_DB_FOLDER: templateDir, SEC_DB_NAME: DB_NAME })
  );
  if (setup.exitCode !== 0) {
    rmSync(templateDir, { recursive: true, force: true });
    throw new Error(
      `db setup failed for the test template (exit ${setup.exitCode}): ${setup.stderr || setup.stdout}`
    );
  }
  const files = readdirSync(templateDir);
  return {
    materialize(): string {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      for (const file of files) {
        copyFileSync(join(templateDir, file), join(dir, file));
      }
      return dir;
    },
    dispose(): void {
      rmSync(templateDir, { recursive: true, force: true });
    },
  };
}
