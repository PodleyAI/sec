/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebCommand } from "@workglow/cli";
import type { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import { parseGlobalOptions } from "../cli/GlobalOptions";
import { setNextStepsQuiet } from "../cli/nextSteps";
import { addBootstrapCommands as addLoadCommands } from "../cli/groups/bootstrap";
import { addAskCommands } from "../cli/groups/ask";
import { addGetCommand } from "../cli/groups/get";
import { addReadCommand } from "../cli/groups/read";
import { addStatusCommand } from "../cli/groups/status";
import { addDbCommands } from "../cli/groups/db";
import { addFetchCommands } from "../cli/groups/fetch";
import { addInitCommand } from "../cli/groups/init";
import { addQueryCommands } from "../cli/groups/query";
import { addSyncCommand } from "../cli/groups/sync";
import { bootstrapSecRuntime } from "../config/bootstrapSecRuntime";
import { SEC_DRY_RUN, SEC_JSON_OUTPUT } from "../config/tokens";
import { registerSecWebUi } from "../web/registerSecWebUi";

/**
 * Whether a command runs without a database, so DI bring-up must be skipped.
 *
 * Two cases, and no set to keep in step with the command tree:
 *
 * - **`setup`**, which is what a person runs when there is no configuration to
 *   read. Requiring one would be a chicken-and-egg.
 * - **`read` given a file or a fixture**, which parses bytes off disk and stores
 *   nothing. Its ACCESSION form is a different command in the same clothes — it
 *   reads `filings.primary_doc`, the fetch cache, and with `--fetch` the
 *   rate-limited queue — so exempting it unconditionally would not degrade
 *   gracefully, it would make that form impossible on every machine, configured
 *   or not. The invocation decides: a positional accession or a `--cik` means
 *   the database is needed.
 */
export function isDiExemptCommand(command: Command): boolean {
  // Matched at the TOP LEVEL, not by leaf name: `db setup` is also called
  // "setup" and needs every repository bound before it can create a table.
  const topLevel = command.parent?.parent == null;
  if (!topLevel) return false;
  if (command.name() === "setup") return true;
  if (command.name() !== "read") return false;
  const { cik, file, fixture, fixtures } = command.opts() as {
    cik?: number | undefined;
    file?: string | undefined;
    fixture?: string | undefined;
    fixtures?: boolean | undefined;
  };
  if (cik !== undefined) return false;
  if (fixtures === true || fixture !== undefined || file !== undefined) return true;
  // A bare positional could be either. `read ./a.htm` is a file and needs
  // nothing; `read 0001234567-25-000001` is an accession and needs the tables.
  const [target] = command.args;
  return target !== undefined && (target.includes("/") || target.toLowerCase().endsWith(".htm"));
}

export const AddCommands = (program: Command): void => {
  let diInitialized = false;

  program.hook("preAction", async (_thisCommand, actionCommand) => {
    if (diInitialized) return;

    // Global flags are registered even for exempt commands so `--json` /
    // `--dry-run` behave uniformly; only the DB/queue/provider setup is skipped.
    const globalOpts = parseGlobalOptions(program);
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, globalOpts.dryRun);
    globalServiceRegistry.registerInstance(SEC_JSON_OUTPUT, globalOpts.json);
    setNextStepsQuiet(globalOpts.quiet);

    if (isDiExemptCommand(actionCommand)) return;
    diInitialized = true;

    await bootstrapSecRuntime();
  });

  // Registration order is help order, and help order is the order a first
  // reader should meet these: set up, see where you are, get one company, keep
  // it current, then the bulk and the escape hatches.
  addInitCommand(program);
  addStatusCommand(program);
  addGetCommand(program);
  addSyncCommand(program);
  addLoadCommands(program);
  addQueryCommands(program);
  addReadCommand(program);
  addAskCommands(program);
  addFetchCommands(program);
  addDbCommands(program);
  registerSecWebUi(program);
  // The console over sec's own tree: `registerWebCommand` reads the commands
  // registered above off the live program, so nothing here has to be restated.
  //
  // The binary name is deliberately NOT pinned to "sec". A superset calls this
  // to inherit the whole SEC surface, and a pinned name made its console render
  // every command line as `sec …` for a binary that is not sec.
  // `registerWebCommand` falls back to `program.name()`, which each entrypoint
  // sets for itself.
  registerWebCommand(program);
};
