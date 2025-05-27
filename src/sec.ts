#!/usr/bin/env bun

import { getTaskQueueRegistry } from "@podley/task-graph";

import { program } from "commander";
import { AddCommands } from "./commands";

program.version("1.0.0").description("A CLI to gather SEC filings into a local database.");

AddCommands(program);


await program.parseAsync(process.argv);

getTaskQueueRegistry().stopQueues();
