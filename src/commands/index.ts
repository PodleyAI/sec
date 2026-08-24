/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { registerWebCommand } from "@workglow/cli";
import { globalServiceRegistry } from "workglow";
import { parseGlobalOptions } from "../cli/GlobalOptions";
import { addBootstrapCommands } from "../cli/groups/bootstrap";
import { addDbCommands } from "../cli/groups/db";
import { addFetchCommands } from "../cli/groups/fetch";
import { addInitCommand } from "../cli/groups/init";
import { addQueryCommands } from "../cli/groups/query";
import { addSyncCommand } from "../cli/groups/sync";
import { addVersionCommands } from "../cli/groups/version";
import { addResolveCommands } from "../cli/groups/resolve";
import { addCanonicalCommands } from "../cli/groups/canonical";
import { addExtractorCommands } from "../cli/groups/extractor";
import { addEvalCommands } from "../cli/groups/eval";
import { registerSponsorFamilyCommands } from "./sponsorFamily";
import { registerUnderwriterFamilyCommands } from "./underwriterFamily";
import { registerSpacCommands } from "./spac";
import { registerEditorialCommands } from "./editorial";
import { bootstrapSecRuntime } from "../config/bootstrapSecRuntime";
import { SEC_DRY_RUN, SEC_JSON_OUTPUT } from "../config/tokens";

/**
 * Commands that touch neither the database nor the job queue, so requiring a
 * configured CLI (`init`) would be pure friction. `golden-fixtures` audits
 * committed files against EDGAR over a plain fetch — needing a SQLite path to
 * run it would block the CI use case it exists for.
 *
 * Exported because a superset CLI (embarc-data) installs its OWN preAction hook
 * to register private-data repos, and that registration calls `createStorage()`,
 * which reads `sec.db.type` — a token only the bootstrap below registers. A
 * superset that exempts a different set therefore crashes on exactly the
 * commands sec deliberately runs without a database. Consume this set rather
 * than restating it, so adding an exempt command here can't leave the superset
 * broken.
 */
export const DI_EXEMPT_COMMANDS: ReadonlySet<string> = new Set(["init", "golden-fixtures"]);

export const AddCommands = (program: Command): void => {
  let diInitialized = false;

  program.hook("preAction", async (_thisCommand, actionCommand) => {
    const commandName = actionCommand.name();
    if (diInitialized) return;

    // Global flags are registered even for exempt commands so `--json` /
    // `--dry-run` behave uniformly; only the DB/queue/provider setup is skipped.
    const globalOpts = parseGlobalOptions(program);
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, globalOpts.dryRun);
    globalServiceRegistry.registerInstance(SEC_JSON_OUTPUT, globalOpts.json);

    if (DI_EXEMPT_COMMANDS.has(commandName)) return;
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
  addResolveCommands(program);
  addCanonicalCommands(program);
  registerSponsorFamilyCommands(program);
  registerUnderwriterFamilyCommands(program);
  registerSpacCommands(program);
  registerEditorialCommands(program);
  addExtractorCommands(program);
  addEvalCommands(program);
  // The console over sec's own tree: `registerWebCommand` reads the commands
  // registered above off the live program, so nothing here has to be restated.
  //
  // The binary name is deliberately NOT pinned to "sec". A superset calls this
  // to inherit the whole SEC surface — embarc-data does — and a pinned name
  // made its console render every command line as `sec …` for a binary that is
  // not sec. `registerWebCommand` falls back to `program.name()`, which each
  // entrypoint sets for itself.
  registerWebCommand(program);
};
