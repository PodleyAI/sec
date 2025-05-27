#!/usr/bin/env bun

import { register_HFT_InlineJobFns, register_TFMP_InlineJobFns } from "@ellmers/ai-provider";
import { getTaskQueueRegistry } from "@ellmers/task-graph";
import {
  register_HFT_InMemoryQueue,
  register_TFMP_InMemoryQueue,
  registerHuggingfaceLocalModels,
  registerMediaPipeTfJsLocalModels,
} from "@ellmers/test";
import { program } from "commander";
import { AddCommands } from "./commands";

program.version("1.0.0").description("A CLI to gather SEC filings.");

AddCommands(program);

await registerHuggingfaceLocalModels();
await register_HFT_InlineJobFns();
await register_HFT_InMemoryQueue();

await registerMediaPipeTfJsLocalModels();
await register_TFMP_InlineJobFns();
await register_TFMP_InMemoryQueue();

await program.parseAsync(process.argv);

getTaskQueueRegistry().stopQueues();
