#!/usr/bin/env bun

import { program } from "commander";
import { getTaskQueueRegistry, Sqlite } from "workglow";
import { applyGlobalOptions } from "./cli/GlobalOptions";
import { AddCommands } from "./commands";
import { SecCliConfigurationError } from "./config/EnvToDI";

program
  .version("2.0.0")
  .description("SEC EDGAR data pipeline — fetch, store, and query SEC filings");

applyGlobalOptions(program);
AddCommands(program);

const secDbType = process.env.SEC_DB_TYPE ?? "sqlite";
if (secDbType === "sqlite" && typeof Sqlite.init === "function") {
  await Sqlite.init();
}

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
