import type { Command } from "commander";
import {
  EXEMPT_OFFERING_FORM_CODES,
  type ExemptOfferingFormCode,
} from "../../sec/forms/exempt-offerings/form-slugs";
import {
  FetchCompanyFactsForCikTask,
  type FetchCompanyFactsForCikTaskOutput,
} from "../../task/facts/FetchCompanyFactsForCikTask";
import {
  DEFAULT_FIXTURES_PER_FORM,
  parseFormCodes,
  parseQuarterStrings,
} from "../../task/fixtures/fetchFixtures";
import {
  FetchFixturesTask,
  type FetchFixturesTaskOutput,
} from "../../task/fixtures/FetchFixturesTask";
import { DEFAULT_MIN_SPAC, DEFAULT_S1_SAMPLE_COUNT } from "../../task/fixtures/fetchS1Fixtures";
import {
  FetchS1FixturesTask,
  type FetchS1FixturesTaskOutput,
} from "../../task/fixtures/FetchS1FixturesTask";
import { GOLDEN_FIXTURES } from "../../task/fixtures/goldenFixtureManifest";
import {
  GoldenFixturesTask,
  type GoldenFixturesTaskOutput,
} from "../../task/fixtures/GoldenFixturesTask";
import {
  ListFormTypesTask,
  type ListFormTypesTaskOutput,
} from "../../task/query/ListFormTypesTask";
import { FetchSubmissionsTask } from "../../task/submissions/FetchSubmissionsTask";
import { StoreSubmissionsTask } from "../../task/submissions/StoreSubmissionsTask";
import { secDate } from "../../util/parseDate";
import { statusMessage } from "../output/Progress";
import { renderTable } from "../output/TableRenderer";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";

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
  const result = await runWorkflowCli<ListFormTypesTaskOutput>([
    new ListFormTypesTask({ defaults: { cik } }),
  ]);
  if (result.empty) {
    console.log(
      `No filings in the local database for CIK ${cik}. Run \`sec fetch submissions ${cik}\` to load filing metadata, then run this command again.`
    );
    return;
  }
  console.log(`Form types available in stored filings for CIK ${cik}:\n`);
  console.log(
    renderTable(
      result.forms as unknown as Record<string, unknown>[],
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
        await runWorkflowCli([
          new FetchSubmissionsTask({
            defaults: {
              cik: parseCikArg(cik),
              date: options.date ? secDate(options.date) : undefined,
            },
          }),
          new StoreSubmissionsTask(),
        ]);
      });
    });

  fetch
    .command("facts <cik>")
    .description("Fetch and store company facts for a single company")
    .option("--date <date>", "Cache buster date")
    .action(async (cik: string, options) => {
      await runCommand(async () => {
        await runWorkflowCli<FetchCompanyFactsForCikTaskOutput>([
          new FetchCompanyFactsForCikTask({
            defaults: {
              cik: parseCikArg(cik),
              date: options.date ? secDate(options.date) : undefined,
            },
          }),
        ]);
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
          const result = await runWorkflowCli<FetchFixturesTaskOutput>([
            new FetchFixturesTask({
              defaults: {
                forms: formCodes,
                count: options.count,
                quarters,
                listOnly: options.list,
              },
            }),
          ]);
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
        const result = await runWorkflowCli<FetchS1FixturesTaskOutput>([
          new FetchS1FixturesTask({
            defaults: { count: options.count, minSpac: options.minSpac },
          }),
        ]);
        console.log(
          `Done. downloaded=${result.downloaded} skipped=${result.skipped} spacs=${result.spacs}`
        );
      });
    });

  fetch
    .command("golden-fixtures")
    .description(
      `Reproduce or verify the ${GOLDEN_FIXTURES.length} committed EDGAR golden fixtures against their pinned manifest`
    )
    .option(
      "--verify",
      "Compare the committed fixtures against EDGAR without writing anything (exits non-zero on any mismatch)"
    )
    .option("--force", "Re-download fixtures that already match the manifest")
    .action(async (options: { verify?: boolean; force?: boolean }) => {
      await runCommand(async () => {
        const result = await runWorkflowCli<GoldenFixturesTaskOutput>([
          new GoldenFixturesTask({
            defaults: { mode: options.verify ? "verify" : "download", force: options.force },
          }),
        ]);
        for (const problem of result.problems) console.error(problem);
        console.log(`Done. ok=${result.ok} written=${result.written} failed=${result.failed}`);
        // A silent pass is the whole point of --verify, so a mismatch has to
        // move the exit code or CI would happily ignore it.
        if (result.failed > 0) {
          throw new Error(`${result.failed} golden fixture(s) did not match the manifest`);
        }
      });
    });
}
