//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { runWorkflow } from "@podley/cli";
import { Workflow } from "@podley/task-graph";
import type { Command } from "commander";
import { createDb } from "../util/db";

export function SetupDB(program: Command) {
  program
    .command("setup-db")
    .description("setup the database")
    .action(async () => {
      const workflow = new Workflow();
      workflow.pipe(function setupDb() {
        createDb();
        return { success: true };
      });
      try {
        await runWorkflow(workflow);
      } catch (error) {
        console.error("Error setting up the database:", error);
      }
    });
}
