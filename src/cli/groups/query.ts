import type { Command } from "commander";
import { InvalidArgumentError } from "commander";
import type { XbrlFactRow } from "../../storage/xbrl/XbrlFactSchema";
import { QueryCiksTask } from "../../task/query/QueryCiksTask";
import { QueryEntitiesTask } from "../../task/query/QueryEntitiesTask";
import { QueryFactsTask } from "../../task/query/QueryFactsTask";
import { QueryFilingsTask } from "../../task/query/QueryFilingsTask";
import { QueryXbrlTask } from "../../task/query/QueryXbrlTask";
import { parseIntOption } from "../GlobalOptions";
import { renderTable, type ColumnDef } from "../output/TableRenderer";
import type { CikQueryResult } from "../queries/CikQuery";
import type { QueryResult } from "../queries/EntityQuery";
import { formatXbrlDimensions, formatXbrlPeriod } from "../queries/XbrlQuery";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";
import { QueryAdvisersTask } from "../../task/query/QueryAdvisersTask";

const FORMAT_CHOICES = ["table", "json", "csv"] as const;
type OutputFormat = (typeof FORMAT_CHOICES)[number];

/** A CIK positional must be entirely digits — a NaN or partial parse would
 * silently query nothing (or the wrong company). */
function parseCikArgStrict(value: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new InvalidArgumentError(`Invalid CIK: ${value}`);
  }
  return Number.parseInt(value.trim(), 10);
}

function validateFormat(value: string): OutputFormat {
  if (!FORMAT_CHOICES.includes(value as OutputFormat)) {
    throw new Error(`Invalid --format "${value}". Must be one of: ${FORMAT_CHOICES.join(", ")}.`);
  }
  return value as OutputFormat;
}

/**
 * Wraps a Commander action so a thrown error (bad --format, repo failure)
 * renders as a clean `x <message>` with exit code 1 — via runCommand — instead
 * of an uncaught stack-trace dump, matching the rest of the CLI surface.
 */
function wrapAction<A extends unknown[]>(
  fn: (...args: A) => Promise<void>
): (...args: A) => Promise<void> {
  return async (...args: A): Promise<void> => {
    await runCommand(() => fn(...args));
  };
}

/** Print a query task's row page through the shared table renderer. */
function renderQueryResult(
  result: QueryResult<unknown>,
  columns: readonly ColumnDef[],
  format: OutputFormat,
  offset: number,
  limit: number
): void {
  console.log(
    renderTable(result.rows as Record<string, unknown>[], columns, {
      format,
      total: result.total,
      totalApprox: result.totalApprox,
      offset,
      limit,
    })
  );
}

export function addQueryCommands(program: Command): void {
  const query = program.command("query").description("Query stored SEC data");

  query
    .command("cik <name>")
    .description("Find CIK numbers by company name (searches the SEC cik_name list)")
    .option("--exact", "Require exact case-insensitive name match", false)
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(
      wrapAction(async (name: string, options: Record<string, unknown>) => {
        const limit = options.limit as number;
        const offset = options.offset as number;
        const format = validateFormat(options.format as string);
        const result = await runWorkflowCli<CikQueryResult>([
          new QueryCiksTask({
            defaults: { name, exact: Boolean(options.exact), limit, offset },
          }),
        ]);

        const columns = [
          { key: "cik", header: "CIK", width: 10 },
          { key: "name", header: "Name", width: 60 },
        ];
        renderQueryResult(result, columns, format, offset, limit);

        if (result.tableEmpty && format === "table") {
          console.log(
            "\nThe cik_names table is empty. Run `sec bootstrap ingest cik-names` to populate it."
          );
        }
      })
    );

  query
    .command("entities [search]")
    .description("Search entities in the database")
    .option("--cik <cik>", "Filter by CIK", parseIntOption)
    .option("--sic <sic>", "Filter by SIC code", parseIntOption)
    .option("--state <state>", "Filter by state")
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--sort <field>", "Sort by field")
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(
      wrapAction(async (search: string | undefined, options: Record<string, unknown>) => {
        const limit = options.limit as number;
        const offset = options.offset as number;
        const format = validateFormat(options.format as string);
        const result = await runWorkflowCli<QueryResult<unknown>>([
          new QueryEntitiesTask({
            defaults: {
              search,
              cik: options.cik as number | undefined,
              sic: options.sic as number | undefined,
              state: options.state as string | undefined,
              limit,
              offset,
              sort: options.sort as string | undefined,
            },
          }),
        ]);

        const columns = [
          { key: "cik", header: "CIK", width: 10 },
          { key: "name", header: "Name", width: 30 },
          { key: "sic", header: "SIC", width: 6 },
          { key: "state_incorporation", header: "State", width: 5 },
        ];
        renderQueryResult(result, columns, format, offset, limit);
      })
    );

  query
    .command("filings [search]")
    .description("Search filings in the database")
    .option("--cik <cik>", "Filter by CIK", parseIntOption)
    .option("--form <form>", "Filter by form type")
    .option("--after <date>", "Filter filings after date")
    .option("--before <date>", "Filter filings before date")
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(
      wrapAction(async (search: string | undefined, options: Record<string, unknown>) => {
        const limit = options.limit as number;
        const offset = options.offset as number;
        const format = validateFormat(options.format as string);
        const result = await runWorkflowCli<QueryResult<unknown>>([
          new QueryFilingsTask({
            defaults: {
              search,
              cik: options.cik as number | undefined,
              form: options.form as string | undefined,
              after: options.after as string | undefined,
              before: options.before as string | undefined,
              limit,
              offset,
            },
          }),
        ]);

        const columns = [
          { key: "cik", header: "CIK", width: 10 },
          { key: "accession_number", header: "Accession", width: 20 },
          { key: "form", header: "Form", width: 8 },
          { key: "filing_date", header: "Filed", width: 12 },
          { key: "primary_doc", header: "Document", width: 25 },
        ];
        renderQueryResult(result, columns, format, offset, limit);
      })
    );

  query
    .command("facts")
    .argument("<cik>", "Issuer CIK (positive integer)", parseIntOption)
    .description("Query company facts")
    .option("--name <name>", "Filter by fact name")
    .option("--taxonomy <taxonomy>", "Filter by taxonomy")
    .option("--year <year>", "Filter by year", parseIntOption)
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(
      wrapAction(async (cik: number, options: Record<string, unknown>) => {
        const limit = options.limit as number;
        const offset = options.offset as number;
        const format = validateFormat(options.format as string);
        const result = await runWorkflowCli<QueryResult<unknown>>([
          new QueryFactsTask({
            defaults: {
              cik,
              name: options.name as string | undefined,
              taxonomy: options.taxonomy as string | undefined,
              year: options.year as number | undefined,
              limit,
              offset,
            },
          }),
        ]);

        const columns = [
          { key: "name", header: "Fact", width: 25 },
          { key: "val", header: "Value", width: 15 },
          { key: "val_unit", header: "Unit", width: 10 },
          { key: "fy", header: "FY", width: 6 },
          { key: "fp", header: "FP", width: 4 },
          { key: "filed_date", header: "Filed", width: 12 },
        ];
        renderQueryResult(result, columns, format, offset, limit);
      })
    );

  query
    .command("advisers [search]")
    .description("Investment advisers from Form ADV")
    .option("--crd <crd>", "Filter by CRD number")
    .option("--state <state>", "Filter by main-office state")
    .option("--snapshot <YYYY-MM>", "Filter to one archive period")
    .option("--min-aum <dollars>", "Only advisers reporting at least this much AUM", parseIntOption)
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(
      wrapAction(async (search: string | undefined, options: Record<string, unknown>) => {
        const limit = options.limit as number;
        const offset = options.offset as number;
        const format = validateFormat(options.format as string);
        const result = await runWorkflowCli<QueryResult<unknown>>([
          new QueryAdvisersTask({
            defaults: {
              search,
              crd: options.crd as string | undefined,
              state: options.state as string | undefined,
              snapshot: options.snapshot as string | undefined,
              minAum: options.minAum as number | undefined,
              limit,
              offset,
            },
          }),
        ]);

        const columns = [
          { key: "crd_number", header: "CRD", width: 10 },
          { key: "legal_name", header: "Legal name", width: 40 },
          { key: "main_office_state", header: "State", width: 6 },
          { key: "regulatory_aum", header: "AUM", width: 16 },
          { key: "snapshot", header: "Snapshot", width: 9 },
        ];
        renderQueryResult(result, columns, format, offset, limit);
      })
    );

  query
    .command("xbrl [accession]")
    .description(
      "XBRL facts extracted from a filing, or a concept's series across an issuer's filings"
    )
    .option(
      "--cik <cik>",
      "Issuer CIK (facts across all the issuer's filings; use instead of an accession)",
      parseIntOption
    )
    .option("--concept <substr>", "Filter by concept QName substring (e.g. TrustAccount)")
    .option("--numeric-only", "Only numeric (ix:nonFraction) facts", false)
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(
      wrapAction(async (accession: string | undefined, options: Record<string, unknown>) => {
        const limit = options.limit as number;
        const offset = options.offset as number;
        const format = validateFormat(options.format as string);

        const cik = options.cik as number | undefined;
        if (accession !== undefined && cik !== undefined) {
          throw new Error("Provide either an accession or --cik, not both.");
        }
        if (accession === undefined && cik === undefined) {
          throw new Error("Provide an accession argument or --cik.");
        }

        const result = await runWorkflowCli<QueryResult<XbrlFactRow>>([
          new QueryXbrlTask({
            defaults: {
              accession,
              cik,
              concept: options.concept as string | undefined,
              numericOnly: Boolean(options.numericOnly),
              limit,
              offset,
            },
          }),
        ]);

        const byCik = cik !== undefined;
        const rows = result.rows.map((r) => ({
          accession: r.accession_number,
          concept: r.concept,
          period: formatXbrlPeriod(r),
          dimensions: formatXbrlDimensions(r),
          unit: r.unit ?? "",
          value: r.is_numeric ? (r.value_numeric ?? r.value_text) : r.value_text,
          source: r.source,
        }));

        // Across-issuer queries need the accession to tell filings apart; a
        // single-filing query already knows it, so drop the redundant column.
        const columns = [
          ...(byCik ? [{ key: "accession", header: "Accession", width: 22 }] : []),
          { key: "concept", header: "Concept", width: 42 },
          { key: "period", header: "Period", width: 22 },
          { key: "dimensions", header: "Dimensions", width: 28 },
          { key: "unit", header: "Unit", width: 10 },
          { key: "value", header: "Value", width: 28 },
          { key: "source", header: "Source", width: 8 },
        ];

        console.log(
          renderTable(rows as Record<string, unknown>[], columns, {
            format,
            total: result.total,
            totalApprox: result.totalApprox,
            offset,
            limit,
          })
        );
      })
    );
}
