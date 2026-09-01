/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebCommand } from "@workglow/cli";
import type { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import { parseGlobalOptions } from "../cli/GlobalOptions";
import { addBootstrapCommands } from "../cli/groups/bootstrap";
import { addDbCommands } from "../cli/groups/db";
import { addExtractorCommands } from "../cli/groups/extractor";
import { addFetchCommands } from "../cli/groups/fetch";
import { addInitCommand } from "../cli/groups/init";
import { addQueryCommands } from "../cli/groups/query";
import { addSyncCommand } from "../cli/groups/sync";
import { addVerifyCommands } from "../cli/groups/verify";
import { addVersionCommands } from "../cli/groups/version";
import { bootstrapSecRuntime } from "../config/bootstrapSecRuntime";
import { SEC_DRY_RUN, SEC_JSON_OUTPUT } from "../config/tokens";
import { registerSecWebUi } from "../web/registerSecWebUi";
import { registerEditorialCommands } from "./editorial";
import { registerIssuerCommands } from "./issuerTickers";

/**
 * Commands that touch neither the database nor the job queue, so requiring a
 * configured CLI (`init`) would be pure friction. `golden-fixtures` audits
 * committed files against EDGAR over a plain fetch — needing a SQLite path to
 * run it would block the CI use case it exists for.
 *
 * Matched on the leaf name, which is what these predate; anything added now
 * should go in {@link DI_EXEMPT_COMMAND_PATHS} instead.
 */
const DI_EXEMPT_COMMANDS: ReadonlySet<string> = new Set(["init", "golden-fixtures"]);

/**
 * The same exemption, keyed by FULL command path.
 *
 * A leaf name is not enough for a group whose leaves are named for stages:
 * `verify all` and `sync all` share one, and only the first can run without a
 * database. A path cannot collide, so new entries belong here.
 *
 * These read a committed fixture, a local file, or a trace directory and touch
 * nothing else.
 */
const DI_EXEMPT_COMMAND_PATHS: ReadonlySet<string> = new Set(["verify fixtures", "verify calls"]);

/**
 * Verify stages that run without a database ONLY in their fixture/file form.
 *
 * Their accession form reads `filings.primary_doc`, the on-disk fetch cache and
 * (with `--fetch`) the rate-limited fetch queue — all of which the bootstrap
 * registers. Exempting them unconditionally does not make that form degrade
 * gracefully, it makes it impossible: `loadFilingHtml` finds no filing
 * repository token and refuses on every machine, configured or not.
 *
 * The invocation is what decides, and a `Command` carries it: a positional
 * accession or a `--cik` means the accession form, and the database is needed.
 */
const DI_EXEMPT_UNLESS_ACCESSION: ReadonlySet<string> = new Set([
  "verify parse",
  "verify sections",
  "verify chunks",
  "verify all",
]);

/** True when a verify stage was invoked in its fixture/file form. */
function isSourcedFromDisk(command: Command): boolean {
  const { cik } = command.opts() as { cik?: number | undefined };
  return cik === undefined && command.args.length === 0;
}

/** A command's path from the program root, e.g. `verify parse`. */
function commandPath(command: Command): string {
  const parts: string[] = [];
  let node: Command | null = command;
  while (node?.parent != null) {
    parts.unshift(node.name());
    node = node.parent;
  }
  return parts.join(" ");
}

/**
 * Whether a command runs without a database, so DI bring-up must be skipped.
 *
 * **This predicate is the contract, and the sets behind it are deliberately not
 * exported.** A superset CLI installs its OWN preAction hook to
 * register private-data repos, and that registration calls `createStorage()`,
 * which reads `sec.db.type` — a token only sec's bootstrap registers. So a
 * superset testing a different condition crashes on exactly the commands sec
 * runs deliberately without a database.
 *
 * That has now happened twice. First when `golden-fixtures` was added to a set
 * a superset restated locally. Then again when `verify` needed path matching
 * and gained a second set the superset did not know to consult — a superset
 * reading only the first set is not restating anything, and still breaks.
 * Exporting one function instead of the data leaves nothing to keep in sync:
 * a new exemption of any shape is picked up by every caller for free.
 */
export function isDiExemptCommand(command: Command): boolean {
  if (DI_EXEMPT_COMMANDS.has(command.name())) return true;
  const path = commandPath(command);
  if (DI_EXEMPT_COMMAND_PATHS.has(path)) return true;
  return DI_EXEMPT_UNLESS_ACCESSION.has(path) && isSourcedFromDisk(command);
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

    if (isDiExemptCommand(actionCommand)) return;
    diInitialized = true;

    await bootstrapSecRuntime();
  });

  addBootstrapCommands(program);
  addSyncCommand(program);
  addFetchCommands(program);
  addQueryCommands(program);
  addDbCommands(program);
  addInitCommand(program);
  addVersionCommands(program);
  registerIssuerCommands(program);
  registerEditorialCommands(program);
  addExtractorCommands(program);
  addVerifyCommands(program);
  // What the console shows for those commands: pickers for the identifiers
  // (CIK, accession, extractor id), panels over their output, the operator
  // rail, and the cost/safety badges. Registration is inert — it reads nothing
  // — so it is safe here, ahead of any runtime.
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
