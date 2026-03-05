#!/usr/bin/env bun

import { getTaskQueueRegistry } from "@workglow/task-graph";
import { program } from "commander";
import { AddCommands } from "./commands";
import { applyGlobalOptions } from "./cli/GlobalOptions";

program.version("2.0.0").description("SEC EDGAR data pipeline — fetch, store, and query SEC filings");

applyGlobalOptions(program);
AddCommands(program);

await program.parseAsync(process.argv);

await getTaskQueueRegistry().stopQueues();
