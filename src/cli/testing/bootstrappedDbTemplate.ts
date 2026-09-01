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
  /**
   * A second template: this one with more CLI commands applied, paid once
   * rather than per test. Tests whose subject is some LATER command reach
   * their starting state through this instead of re-running the ceremonies
   * that build it.
   */
  derive(prefix: string, commands: readonly (readonly string[])[]): Promise<BootstrappedDbTemplate>;
  /** Removes the template itself. */
  dispose(): void;
}

function templateOver(dir: string, prefix: string): BootstrappedDbTemplate {
  const files = readdirSync(dir);
  return {
    materialize(): string {
      const target = mkdtempSync(join(tmpdir(), prefix));
      for (const file of files) {
        copyFileSync(join(dir, file), join(target, file));
      }
      return target;
    },
    async derive(
      derivedPrefix: string,
      commands: readonly (readonly string[])[]
    ): Promise<BootstrappedDbTemplate> {
      const derivedDir = mkdtempSync(join(tmpdir(), `${derivedPrefix}template-`));
      for (const file of files) {
        copyFileSync(join(dir, file), join(derivedDir, file));
      }
      for (const command of commands) {
        await runTemplateCommand(derivedDir, command, derivedPrefix);
      }
      return templateOver(derivedDir, derivedPrefix);
    },
    dispose(): void {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** One CLI command against a template folder, failing loudly rather than leaving a half-built fixture. */
async function runTemplateCommand(
  dir: string,
  command: readonly string[],
  prefix: string
): Promise<void> {
  const result = await runCliProcess(
    ["bun", "src/sec.ts", ...command],
    cliEnv({ SEC_DB_TYPE: "sqlite", SEC_DB_FOLDER: dir, SEC_DB_NAME: DB_NAME })
  );
  if (result.exitCode !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(
      `\`${command.join(" ")}\` failed building the ${prefix} template (exit ${result.exitCode}): ` +
        `${result.stderr || result.stdout}`
    );
  }
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
  await runTemplateCommand(templateDir, ["db", "setup"], prefix);
  return templateOver(templateDir, prefix);
}
