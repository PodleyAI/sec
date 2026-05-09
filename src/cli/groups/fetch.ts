import { withCli } from "@workglow/cli";
import type { Command } from "commander";
import { Workflow } from "workglow";
import { isFormParsingSupported } from "../../sec/forms/all-forms";
import { EntityRepo } from "../../storage/entity/EntityRepo";
import { FetchCompanyFactsTask } from "../../task/facts/FetchCompanyFactsTask";
import { StoreCompanyFactsTask } from "../../task/facts/StoreCompanyFactsTask";
import { FetchAndStoreFormsTask } from "../../task/forms/FetchAndStoreFormsTask";
import { ProcessAccessionDocFormTask } from "../../task/forms/ProcessAccessionDocFormTask";
import { FetchSubmissionsTask } from "../../task/submissions/FetchSubmissionsTask";
import { StoreSubmissionsTask } from "../../task/submissions/StoreSubmissionsTask";
import { secDate } from "../../util/parseDate";
import { renderTable } from "../output/TableRenderer";
import { runCommand } from "../runCommand";

function parseCikArg(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid CIK "${value}": must be a positive integer`);
  }
  return parsed;
}

async function listAvailableFormTypesForCik(cik: number): Promise<void> {
  const entityRepo = new EntityRepo();
  const filings = await entityRepo.getFilings(cik);
  const counts = new Map<string, number>();
  for (const f of filings) {
    if (f.form == null || f.form === "") continue;
    counts.set(f.form, (counts.get(f.form) ?? 0) + 1);
  }
  if (counts.size === 0) {
    console.log(
      `No filings in the local database for CIK ${cik}. Run \`sec fetch submissions ${cik}\` to load filing metadata, then run this command again.`
    );
    return;
  }
  const rows = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([form, count]) => ({
      form,
      count,
      parse: isFormParsingSupported(form) ? "yes" : "no",
    }));
  console.log(`Form types available in stored filings for CIK ${cik}:\n`);
  console.log(
    renderTable(
      rows as Record<string, unknown>[],
      [
        { key: "form", header: "Form", width: 24 },
        { key: "count", header: "Filings", width: 10 },
        { key: "parse", header: "Parse", width: 5 },
      ],
      { format: "table" }
    )
  );
  console.log(`\nExample: sec fetch form ${cik} <form> [accession]`);
}

export function addFetchCommands(program: Command): void {
  const fetch = program.command("fetch").description("Fetch data for a single entity");

  fetch
    .command("submissions <cik>")
    .description("Fetch and store submissions for a single company")
    .option("--date <date>", "Cache buster date")
    .action(async (cik: string, options) => {
      await runCommand(async () => {
        const wf = new Workflow();
        wf.pipe(
          new FetchSubmissionsTask({
            defaults: {
              cik: parseCikArg(cik),
              date: options.date ? secDate(options.date) : undefined,
            },
          }),
          new StoreSubmissionsTask()
        );
        await withCli(wf).run();
      });
    });

  fetch
    .command("facts <cik>")
    .description("Fetch and store company facts for a single company")
    .option("--date <date>", "Cache buster date")
    .action(async (cik: string, options) => {
      await runCommand(async () => {
        const wf = new Workflow();
        wf.pipe(
          new FetchCompanyFactsTask({
            defaults: {
              cik: parseCikArg(cik),
              date: options.date ? secDate(options.date) : undefined,
            },
          }),
          new StoreCompanyFactsTask()
        );
        await withCli(wf).run();
      });
    });

  fetch
    .command("form <cik> [form] [accession]")
    .description(
      "Fetch and store a specific form for a company; omit <form> to list form types present in local filings"
    )
    .action(async (cik: string, form?: string, accession?: string) => {
      await runCommand(async () => {
        const cikNum = parseCikArg(cik);
        if (form === undefined) {
          await listAvailableFormTypesForCik(cikNum);
          return;
        }
        await withCli(new FetchAndStoreFormsTask()).run({
          cik: cikNum,
          form,
          docid: accession,
        });
      });
    });

  fetch
    .command("doc <accession> [filename]")
    .description("Process a specific accession document")
    .action(async (accession: string, filename?: string) => {
      await runCommand(async () => {
        await withCli(new ProcessAccessionDocFormTask()).run({
          accessionNumber: accession,
          fileName: filename,
        });
      });
    });
}
