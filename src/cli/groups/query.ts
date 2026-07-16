import type { Command } from "commander";
import type { QueryResult } from "../queries/EntityQuery";
import type { CikQueryResult } from "../queries/CikQuery";
import { formatXbrlDimensions, formatXbrlPeriod } from "../queries/XbrlQuery";
import type { XbrlFactRow } from "../../storage/xbrl/XbrlFactSchema";
import { QueryCiksTask } from "../../task/query/QueryCiksTask";
import { QueryCrowdfundingTask } from "../../task/query/QueryCrowdfundingTask";
import { QueryEntitiesTask } from "../../task/query/QueryEntitiesTask";
import { QueryFactsTask } from "../../task/query/QueryFactsTask";
import { QueryFilingsTask } from "../../task/query/QueryFilingsTask";
import { QueryOfferingsTask } from "../../task/query/QueryOfferingsTask";
import { QueryPersonsTask } from "../../task/query/QueryPersonsTask";
import {
  QueryRegASummaryTask,
  type QueryRegASummaryTaskOutput,
} from "../../task/query/QueryRegASummaryTask";
import { QueryRegATask } from "../../task/query/QueryRegATask";
import { QueryXbrlTask } from "../../task/query/QueryXbrlTask";
import { parseIntOption } from "../GlobalOptions";
import { renderTable, type ColumnDef } from "../output/TableRenderer";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";

const FORMAT_CHOICES = ["table", "json", "csv"] as const;
type OutputFormat = (typeof FORMAT_CHOICES)[number];

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
    .option("--cik <cik>", "Filter by CIK")
    .option("--sic <sic>", "Filter by SIC code")
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
              cik: options.cik ? parseInt(options.cik as string, 10) : undefined,
              sic: options.sic ? parseInt(options.sic as string, 10) : undefined,
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
    .option("--cik <cik>", "Filter by CIK")
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
              cik: options.cik ? parseInt(options.cik as string, 10) : undefined,
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
    .command("offerings [search]")
    .description("Search investment offerings")
    .option("--cik <cik>", "Filter by CIK")
    .option("--industry <industry>", "Filter by industry")
    .option("--exemption <exemption>", "Filter by exemption type")
    .option("--after <date>", "Filter after date")
    .option("--before <date>", "Filter before date")
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(
      wrapAction(async (search: string | undefined, options: Record<string, unknown>) => {
        const limit = options.limit as number;
        const offset = options.offset as number;
        const format = validateFormat(options.format as string);
        const result = await runWorkflowCli<QueryResult<unknown>>([
          new QueryOfferingsTask({
            defaults: {
              search,
              cik: options.cik ? parseInt(options.cik as string, 10) : undefined,
              industry: options.industry as string | undefined,
              exemption: options.exemption as string | undefined,
              after: options.after as string | undefined,
              before: options.before as string | undefined,
              limit,
              offset,
            },
          }),
        ]);

        const columns = [
          { key: "cik", header: "CIK", width: 10 },
          { key: "file_number", header: "File #", width: 12 },
          { key: "industry_group", header: "Industry", width: 20 },
          { key: "date_of_first_sale", header: "First Sale", width: 12 },
        ];
        renderQueryResult(result, columns, format, offset, limit);
      })
    );

  query
    .command("crowdfunding [search]")
    .description("Search crowdfunding offerings")
    .option("--cik <cik>", "Filter by CIK")
    .option("--portal <portal>", "Filter by portal")
    .option("--after <date>", "Filter after date")
    .option("--before <date>", "Filter before date")
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(
      wrapAction(async (search: string | undefined, options: Record<string, unknown>) => {
        const limit = options.limit as number;
        const offset = options.offset as number;
        const format = validateFormat(options.format as string);
        const result = await runWorkflowCli<QueryResult<unknown>>([
          new QueryCrowdfundingTask({
            defaults: {
              search,
              cik: options.cik ? parseInt(options.cik as string, 10) : undefined,
              portal: options.portal ? parseInt(options.portal as string, 10) : undefined,
              after: options.after as string | undefined,
              before: options.before as string | undefined,
              limit,
              offset,
            },
          }),
        ]);

        const columns = [
          { key: "cik", header: "CIK", width: 10 },
          { key: "name", header: "Name", width: 25 },
          { key: "filing_date", header: "Filed", width: 12 },
          { key: "status", header: "Status", width: 10 },
        ];
        renderQueryResult(result, columns, format, offset, limit);
      })
    );

  query
    .command("reg-a [search]")
    .description("Search Regulation A offerings (Form 1-A / 1-K / 1-Z data)")
    .option("--cik <cik>", "Filter by CIK", parseIntOption)
    .option("--tier <tier>", "Filter by tier (Tier1, Tier2)")
    .option("--status <status>", "Filter by status (pending, reporting, exit)")
    .option("--jurisdiction <code>", "Filter by jurisdiction of organization")
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(
      wrapAction(async (search: string | undefined, options: Record<string, unknown>) => {
        const limit = options.limit as number;
        const offset = options.offset as number;
        const format = validateFormat(options.format as string);
        const result = await runWorkflowCli<QueryResult<unknown>>([
          new QueryRegATask({
            defaults: {
              search,
              cik: options.cik as number | undefined,
              tier: options.tier as string | undefined,
              status: options.status as string | undefined,
              jurisdiction: options.jurisdiction as string | undefined,
              limit,
              offset,
            },
          }),
        ]);

        const columns = [
          { key: "cik", header: "CIK", width: 10 },
          { key: "file_number", header: "File #", width: 12 },
          { key: "issuer_name", header: "Issuer", width: 30 },
          { key: "tier", header: "Tier", width: 6 },
          { key: "status", header: "Status", width: 10 },
          { key: "jurisdiction", header: "Juris", width: 6 },
        ];
        renderQueryResult(result, columns, format, offset, limit);
      })
    );

  query
    .command("reg-a-summary [cik]")
    .description(
      "Roll up Regulation A offerings: counts by status/tier, plus the latest aggregate offering amount when a CIK is given"
    )
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(
      wrapAction(async (cik: string | undefined, options: Record<string, unknown>) => {
        const format = validateFormat(options.format as string);
        const summary = await runWorkflowCli<QueryRegASummaryTaskOutput>([
          new QueryRegASummaryTask({
            defaults: { cik: cik ? parseIntOption(cik) : undefined },
          }),
        ]);

        const rows: Array<{ metric: string; value: string | number }> = [
          { metric: "offerings", value: summary.offeringCount },
          ...Object.entries(summary.byStatus).map(([status, n]) => ({
            metric: `status:${status}`,
            value: n,
          })),
          ...Object.entries(summary.byTier).map(([tier, n]) => ({
            metric: `tier:${tier}`,
            value: n,
          })),
        ];
        if (summary.latestAggregateOffering != null) {
          rows.push({
            metric: "latest aggregate offering ($)",
            value: summary.latestAggregateOffering,
          });
        }

        console.log(
          renderTable(
            rows as Record<string, unknown>[],
            [
              { key: "metric", header: "Metric", width: 32 },
              { key: "value", header: "Value", width: 20 },
            ],
            { format }
          )
        );
      })
    );

  query
    .command("facts <cik>")
    .description("Query company facts")
    .option("--name <name>", "Filter by fact name")
    .option("--taxonomy <taxonomy>", "Filter by taxonomy")
    .option("--year <year>", "Filter by year", parseIntOption)
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(
      wrapAction(async (cik: string, options: Record<string, unknown>) => {
        const limit = options.limit as number;
        const offset = options.offset as number;
        const format = validateFormat(options.format as string);
        const result = await runWorkflowCli<QueryResult<unknown>>([
          new QueryFactsTask({
            defaults: {
              cik: parseInt(cik, 10),
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
    .command("xbrl [accession]")
    .description(
      "XBRL facts extracted from a filing, or a concept's series across an issuer's filings"
    )
    .option(
      "--cik <cik>",
      "Issuer CIK (facts across all the issuer's filings; use instead of an accession)"
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

        const cikRaw = options.cik as string | undefined;
        let cik: number | undefined;
        if (cikRaw !== undefined) {
          // Require an all-digit string; parseInt would silently accept
          // "123abc" as 123 and produce a plausible-but-wrong CIK.
          const trimmed = cikRaw.trim();
          if (!/^\d+$/.test(trimmed)) {
            throw new Error(`Invalid --cik "${cikRaw}". Must be a positive integer.`);
          }
          cik = Number(trimmed);
        }
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

  query
    .command("persons [search]")
    .description("Search persons in the database")
    .option("--cik <cik>", "Filter by CIK")
    .option("--relationship <relationship>", "Filter by relationship")
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(
      wrapAction(async (search: string | undefined, options: Record<string, unknown>) => {
        const limit = options.limit as number;
        const offset = options.offset as number;
        const format = validateFormat(options.format as string);
        const result = await runWorkflowCli<QueryResult<unknown>>([
          new QueryPersonsTask({
            defaults: {
              search,
              cik: options.cik ? parseInt(options.cik as string, 10) : undefined,
              relationship: options.relationship as string | undefined,
              limit,
              offset,
            },
          }),
        ]);

        const columns = [
          { key: "first_name", header: "First", width: 15 },
          { key: "last_name", header: "Last", width: 20 },
          { key: "titles", header: "Title", width: 20 },
          { key: "source_filing_issuer_cik", header: "CIK", width: 10 },
        ];
        renderQueryResult(result, columns, format, offset, limit);
      })
    );
}
