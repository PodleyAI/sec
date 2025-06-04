//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { runTasks } from "@podley/cli";
import type { Command } from "commander";
import { FetchAndStoreFormsTask } from "../task/forms/FetchAndStoreFormsTask";

export function Form(program: Command) {
  program
    .command("form")
    .description("get the form")
    .argument("<cik>", "cik to get the company submissions for")
    .argument("<form>", "form to get")
    .argument("[docid]", "accession number")
    .action(async (cik: string, form: string, docid: string) => {
      const wf = new FetchAndStoreFormsTask({
        docid: docid,
        cik: parseInt(cik),
        form: form,
      });
      try {
        await runTasks(wf);
      } catch (error) {
        console.error("Error running form workflow:", error);
      }
    });
}
