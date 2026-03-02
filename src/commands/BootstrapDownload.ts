/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { runTasks } from "@workglow/cli";
import type { Command } from "commander";
import { BootstrapDownloadTask } from "../task/bootstrap/BootstrapDownloadTask";

const BULK_DOWNLOADS = {
  submissions: {
    url: "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip",
    targetFolder: "submissions",
  },
  companyfacts: {
    url: "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip",
    targetFolder: "companyfacts",
  },
} as const;

export function BootstrapDownload(program: Command) {
  program
    .command("bootstrap-download <type>")
    .description("download and extract bulk SEC data (submissions, companyfacts, or all)")
    .action(async (type: string) => {
      if (type !== "submissions" && type !== "companyfacts" && type !== "all") {
        console.error(`Invalid type "${type}". Must be submissions, companyfacts, or all.`);
        process.exit(1);
      }

      const types: (keyof typeof BULK_DOWNLOADS)[] =
        type === "all" ? ["submissions", "companyfacts"] : [type];

      try {
        for (const t of types) {
          const config = BULK_DOWNLOADS[t];
          const task = new BootstrapDownloadTask(config);
          await runTasks(task);
        }
      } catch (error) {
        console.error("Error downloading bulk data:", error);
      }
    });
}
