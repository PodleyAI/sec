#!/usr/bin/env bun

import { program } from "commander";
import { getTaskQueueRegistry } from "workglow";
import { applyGlobalOptions } from "./cli/GlobalOptions";
import { AddCommands } from "./commands";
import { SecCliConfigurationError } from "./config/EnvToDI";
import { closeDb } from "./util/db";
import { closePgPool } from "./util/pg";

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
} finally {
  await getTaskQueueRegistry().stopQueues();
  closeDb();
  await closePgPool();
}
