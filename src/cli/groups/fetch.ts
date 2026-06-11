import { withCli } from "@workglow/cli";
import type { Command } from "commander";
import { Workflow, type IExecuteContext } from "workglow";
import { isFormParsingSupported } from "../../sec/forms/all-forms";
import {
  EXEMPT_OFFERING_FORM_CODES,
  type ExemptOfferingFormCode,
} from "../../sec/forms/exempt-offerings/form-slugs";
import { EntityRepo } from "../../storage/entity/EntityRepo";
import { fetchAndStoreCompanyFacts } from "../../task/facts/fetchAndStoreCompanyFacts";
import {
  DEFAULT_FIXTURES_PER_FORM,
  fetchFixtures,
  parseFormCodes,
  parseQuarterStrings,
} from "../../task/fixtures/fetchFixtures";
import {
  DEFAULT_MIN_SPAC,
  DEFAULT_S1_SAMPLE_COUNT,
  fetchS1Fixtures,
} from "../../task/fixtures/fetchS1Fixtures";
import { edgarS1Deps } from "../../task/fixtures/s1FixtureSource";
import { FetchAndStoreFormsTask } from "../../task/forms/FetchAndStoreFormsTask";
import { ProcessAccessionDocFormTask } from "../../task/forms/ProcessAccessionDocFormTask";
import { FetchSubmissionsTask } from "../../task/submissions/FetchSubmissionsTask";
import { StoreSubmissionsTask } from "../../task/submissions/StoreSubmissionsTask";
import { secDate } from "../../util/parseDate";
import { renderTable } from "../output/TableRenderer";
import { runCommand } from "../runCommand";

function parseCikArg(value: string): number {
  // Require an all-digit string. parseInt would silently accept "123abc" as
  // 123 and produce a plausible-looking but wrong CIK.
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid CIK "${value}": must be a positive integer`);
  }
  const parsed = Number(trimmed);
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
        // Route through the orchestrator (not a raw Fetch→Store pipe) so the
        // processed_facts outcome — incl. NO_XBRL_FACTS on 404 — is recorded
        // exactly once, same as the batch update path.
        const cikNum = parseCikArg(cik);
        const date = options.date ? secDate(options.date) : undefined;
        const wf = new Workflow();
        wf.pipe(async (_input: Record<string, never>, ctx: IExecuteContext) => {
          return await fetchAndStoreCompanyFacts({ cik: cikNum, date }, ctx);
        });
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

  fetch
    .command("fixtures [forms...]")
    .description(
      "Download real EDGAR filings for the exempt-offering forms into mock_data/ (development tooling for the test fixture set)"
    )
    .option(
      `-c, --count <n>`,
      `Max fixtures to download per form (default ${DEFAULT_FIXTURES_PER_FORM})`,
      (v) => Number(v)
    )
    .option(
      "-q, --quarter <quarter>",
      "Quarter to source from (YYYYQn). Repeatable.",
      (v, prev: string[]) => [...prev, v],
      [] as string[]
    )
    .option("--list", "Print accessions that would be downloaded without fetching them")
    .action(
      async (forms: string[], options: { count?: number; quarter: string[]; list?: boolean }) => {
        await runCommand(async () => {
          const formCodes: ExemptOfferingFormCode[] =
            forms.length > 0 ? parseFormCodes(forms) : [...EXEMPT_OFFERING_FORM_CODES];
          const quarters =
            options.quarter.length > 0 ? parseQuarterStrings(options.quarter) : undefined;
          const result = await fetchFixtures({
            forms: formCodes,
            count: options.count,
            quarters,
            listOnly: options.list,
            log: (msg) => console.log(msg),
          });
          console.log(
            `Done. downloaded=${result.downloaded} failed=${result.failed} skipped=${result.skipped}`
          );
        });
      }
    );

  fetch
    .command("s1-fixtures")
    .description(
      "Download a random sample of real S-1 prospectus HTML (>= 3 SPACs) into the gitignored mock_data/s1/.cache for converter testing"
    )
    .option(
      "-c, --count <n>",
      `Number of filings to sample (default ${DEFAULT_S1_SAMPLE_COUNT})`,
      (v) => Number(v)
    )
    .option(
      "--min-spac <n>",
      `Minimum SPAC (SIC 6770) filings to include (default ${DEFAULT_MIN_SPAC})`,
      (v) => Number(v)
    )
    .action(async (options: { count?: number; minSpac?: number }) => {
      await runCommand(async () => {
        const result = await fetchS1Fixtures({
          count: options.count,
          minSpac: options.minSpac,
          deps: edgarS1Deps((msg) => console.log(msg)),
        });
        console.log(
          `Done. downloaded=${result.downloaded} skipped=${result.skipped} spacs=${result.spacs}`
        );
      });
    });
}
