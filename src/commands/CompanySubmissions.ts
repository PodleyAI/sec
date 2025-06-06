//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { runWorkflow } from "@podley/cli";
import { Workflow } from "@podley/task-graph";
import type { Command } from "commander";
import { FetchSubmissionsTask } from "../task/submissions/FetchSubmissionsTask";
import { StoreSubmissionsTask } from "../task/submissions/StoreSubmissionsTask";
import { secDate } from "../util/parseDate";

export function CompanySubmissions(program: Command) {
  program
    .command("company-submissions")
    .description("get the company submissions for a given date")
    .option("--date <date>", "cache buster")
    .argument("<cik>", "cik to get the company submissions for")
    .action(async (cik: string, options) => {
      const wf = new Workflow();
      wf.pipe(
        new FetchSubmissionsTask({
          date: options.date ? secDate(options.date) : undefined,
          cik: parseInt(cik),
        }),
        new StoreSubmissionsTask()
      );
      try {
        await runWorkflow(wf);
      } catch (error) {
        console.error("Error running company submissions workflow:", error);
      }
    });
}
