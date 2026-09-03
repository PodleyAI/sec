/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import {
  ConvertFilingDocumentsTask,
  type ConvertFilingDocumentsTaskOutput,
} from "../../task/document/ConvertFilingDocumentsTask";
import { FetchCompanyFactsForCikTask } from "../../task/facts/FetchCompanyFactsForCikTask";
import { FetchSubmissionsTask } from "../../task/submissions/FetchSubmissionsTask";
import { StoreSubmissionsTask } from "../../task/submissions/StoreSubmissionsTask";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { parseIntOption } from "../GlobalOptions";
import { suggest } from "../nextSteps";
import { statusMessage } from "../output/Progress";
import { describeUnresolved, resolveCompany } from "../resolveCompany";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";

/** How many of a company's filings the follow-up conversion takes by default. */
const DEFAULT_GET_CONVERT_LIMIT = 100;

/** The newest filing worth reading, for the suggestion after a fetch. */
async function newestConvertibleAccession(cik: number): Promise<string | undefined> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const rows = (await repo.query({ cik }, { limit: 500 })) ?? [];
  const sorted = [...rows].sort((a, b) => (b.filing_date ?? "").localeCompare(a.filing_date ?? ""));
  return sorted[0]?.accession_number;
}

export function addGetCommand(program: Command): void {
  program
    .command("get <company>")
    .description("Everything for one company: submissions, facts, and readable documents")
    .option("--no-documents", "Skip converting the company's filings to markdown")
    .option("--no-facts", "Skip the XBRL company-facts fetch")
    .option(
      "--limit <n>",
      `Filings to convert (default ${DEFAULT_GET_CONVERT_LIMIT})`,
      parseIntOption
    )
    .option("--force", "Re-fetch and re-convert even where a stored copy exists", false)
    .action(
      async (
        company: string,
        options: {
          documents?: boolean;
          facts?: boolean;
          limit?: number;
          force?: boolean;
        }
      ) => {
        await runCommand(async () => {
          const ref = await resolveCompany(company);
          if (ref.kind !== "resolved") {
            throw new Error(describeUnresolved(ref));
          }

          console.log(statusMessage("info", `${ref.name} (CIK ${ref.cik})`));

          // One graph, so the progress UI shows this as a single run rather
          // than three: what a reader asked for is "this company", not three
          // stages they have to know the names of.
          await runWorkflowCli([
            new FetchSubmissionsTask({ defaults: { cik: ref.cik } }),
            new StoreSubmissionsTask(),
          ]);

          if (options.facts !== false) {
            await runWorkflowCli([new FetchCompanyFactsForCikTask({ defaults: { cik: ref.cik } })]);
          }

          let converted: ConvertFilingDocumentsTaskOutput | undefined;
          if (options.documents !== false) {
            converted = await runWorkflowCli<ConvertFilingDocumentsTaskOutput>([
              new ConvertFilingDocumentsTask({
                defaults: {
                  cik: ref.cik,
                  limit: options.limit ?? DEFAULT_GET_CONVERT_LIMIT,
                  force: options.force === true,
                },
              }),
            ]);
          }

          const accession = await newestConvertibleAccession(ref.cik);
          if (accession !== undefined) {
            suggest({ command: `sec read ${accession}`, why: "read its newest filing" });
          }
          if (converted !== undefined && converted.documents > 0) {
            suggest({
              command: `sec ask "..." --company ${ref.cik}`,
              why: "ask a question about what was converted",
            });
          } else if (options.documents === false) {
            suggest({
              command: `sec update documents --cik ${ref.cik}`,
              why: "convert its filings to readable markdown",
            });
          }
        });
      }
    );
}
