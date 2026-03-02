/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { runWorkflow } from "@workglow/cli";
import type { Command } from "commander";
import { FetchAllCikNamesTask } from "../task/ciknames/FetchAllCikNamesTask";
import { pipe } from "@workglow/task-graph";
import { StoreCikNamesTask } from "../task/ciknames/StoreCikNamesTask";

export function BootstrapAllCikNames(program: Command) {
  program
    .command("bootstrap-all-cik-names")
    .description("bootstrap the all cik names task")
    .action(async () => {
      const wf = pipe([new FetchAllCikNamesTask(), new StoreCikNamesTask()]);
      try {
        await runWorkflow(wf);
      } catch (error) {
        console.error("Error running bootstrap all cik names task:", error);
      }
    });
}
