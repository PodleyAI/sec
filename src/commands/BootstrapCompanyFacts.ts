/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { runTasks } from "@workglow/cli";
import type { Command } from "commander";
import { BootstrapCompanyFactsTask } from "../task/facts/BootstrapCompanyFactsTask";

export function BootstrapCompanyFacts(program: Command) {
  program
    .command("bootstrap-company-facts")
    .description("bootstrap company facts from pre-downloaded files in SEC_RAW_DATA_FOLDER")
    .action(async () => {
      const task = new BootstrapCompanyFactsTask();
      try {
        await runTasks(task);
      } catch (error) {
        console.error("Error bootstrapping company facts:", error);
      }
    });
}
