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
import { registerSponsorFamilyCommands } from "./sponsorFamily";
import { registerUnderwriterFamilyCommands } from "./underwriterFamily";
import { registerSpacCommands } from "./spac";
import { DefaultDI } from "../config/DefaultDI";
import { EnvToDI } from "../config/EnvToDI";
import { SEC_DRY_RUN } from "../config/tokens";
import { SecJobQueueClient, SecJobQueueServer, SecJobQueueStorage } from "../fetch/SecJobQueue";

export const AddCommands = (program: Command): void => {
  let diInitialized = false;

  program.hook("preAction", async (_thisCommand, actionCommand) => {
    const commandName = actionCommand.name();
    if (commandName === "init") return;
    if (diInitialized) return;
    diInitialized = true;

    // Load the SQLite native binding only for commands that may open the DB,
    // not for `init`, `--help`, `--version`, or any pure-CLI invocation.
    const secDbType = process.env.SEC_DB_TYPE ?? "sqlite";
    if (secDbType === "sqlite" && typeof Sqlite.init === "function") {
      await Sqlite.init();
    }

    const globalOpts = parseGlobalOptions(program);
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, globalOpts.dryRun);

    EnvToDI();
    DefaultDI();

    getTaskQueueRegistry().registerQueue({
      server: SecJobQueueServer,
      client: SecJobQueueClient,
      storage: SecJobQueueStorage,
    });
    // Must await: otherwise a fast command can finish and stopQueues() while start() is
    // still in fixupJobs(); stop() then completes before workers start, and start()
    // resumes and leaves workers running — process never exits (e.g. `sec db status`).
    await SecJobQueueServer.start();
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
  addExtractorCommands(program);
};
