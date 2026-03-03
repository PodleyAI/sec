/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { runTasks } from "@workglow/cli";
import type { Command } from "commander";
import { BootstrapSubmissionsTask } from "../task/submissions/BootstrapSubmissionsTask";

export function BootstrapSubmissions(program: Command) {
  program
    .command("bootstrap-submissions")
    .description("bootstrap submissions from pre-downloaded files in SEC_RAW_DATA_FOLDER")
    .action(async () => {
      const task = new BootstrapSubmissionsTask();
      try {
        await runTasks(task);
      } catch (error) {
        console.error("Error bootstrapping submissions:", error);
      }
    });
}
