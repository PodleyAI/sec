#!/usr/bin/env bun

import { getTaskQueueRegistry } from "@workglow/task-graph";
import { program } from "commander";
import { AddCommands } from "./commands";
import { applyGlobalOptions } from "./cli/GlobalOptions";
import { SecCliConfigurationError } from "./config/EnvToDI";

program
  .version("2.0.0")
  .description("SEC EDGAR data pipeline — fetch, store, and query SEC filings");

applyGlobalOptions(program);
AddCommands(program);

try {
  await program.parseAsync(process.argv);
} catch (e) {
  if (e instanceof SecCliConfigurationError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

await getTaskQueueRegistry().stopQueues();
