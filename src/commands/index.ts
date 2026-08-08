/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { getTaskQueueRegistry, globalServiceRegistry, Sqlite } from "workglow";
import { parseGlobalOptions } from "../cli/GlobalOptions";
import { addBootstrapCommands } from "../cli/groups/bootstrap";
import { addDbCommands } from "../cli/groups/db";
import { addFetchCommands } from "../cli/groups/fetch";
import { addInitCommand } from "../cli/groups/init";
import { addQueryCommands } from "../cli/groups/query";
import { addSyncCommand } from "../cli/groups/sync";
import { addUpdateCommands } from "../cli/groups/update";
import { addVersionCommands } from "../cli/groups/version";
import { addResolveCommands } from "../cli/groups/resolve";
import { addCanonicalCommands } from "../cli/groups/canonical";
import { addExtractorCommands } from "../cli/groups/extractor";
import { addEvalCommands } from "../cli/groups/eval";
import { registerSponsorFamilyCommands } from "./sponsorFamily";
import { registerUnderwriterFamilyCommands } from "./underwriterFamily";
import { registerSpacCommands } from "./spac";
import { registerEditorialCommands } from "./editorial";
import { DefaultDI } from "../config/DefaultDI";
import { EnvToDI } from "../config/EnvToDI";
import { getExtractionTemperature } from "../config/extractionTemperature";
import { registerSecModels } from "../config/registerModels";
import { registerSecProviders } from "../config/registerProviders";
import { registerSecResolvers } from "../config/registerResolvers";
import { SEC_DRY_RUN, SEC_JSON_OUTPUT } from "../config/tokens";
import { getSecJobQueue } from "../task/fetch/SecJobQueue";

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

    // Load the SQLite native binding only for commands that may open the DB,
    // not for `init`, `--help`, `--version`, or any pure-CLI invocation.
    const secDbType = process.env.SEC_DB_TYPE ?? "sqlite";
    if (secDbType === "sqlite" && typeof Sqlite.init === "function") {
      await Sqlite.init();
    }

    EnvToDI();
    // Validate the extraction sampling knob at startup. Its only other caller
    // is inside the per-section handler that turns any throw into a
    // version-gated dead letter, so a malformed SEC_EXTRACTION_TEMPERATURE
    // would otherwise be recorded once per section per filing as an extraction
    // failure no version bump can fix, instead of aborting here naming the
    // variable.
    getExtractionTemperature();
    DefaultDI();
    registerSecResolvers();
    await registerSecModels();
    await registerSecProviders();

    // Built lazily (after DI/env) so the Postgres-backed shared rate limiter
    // can read the pool + SEC_DB_TYPE from the registry.
    const secJobQueue = await getSecJobQueue();
    getTaskQueueRegistry().registerQueue({
      server: secJobQueue.server,
      client: secJobQueue.client,
      storage: secJobQueue.storage,
    });
    // Must await: otherwise a fast command can finish and stopQueues() while start() is
    // still in fixupJobs(); stop() then completes before workers start, and start()
    // resumes and leaves workers running — process never exits (e.g. `sec db status`).
    await secJobQueue.server.start();
  });

  addBootstrapCommands(program);
  addSyncCommand(program);
  addUpdateCommands(program);
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
};
