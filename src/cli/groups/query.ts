import type { Command } from "commander";
import { parseIntOption } from "../GlobalOptions";
import { renderTable } from "../output/TableRenderer";
import { queryCiks } from "../queries/CikQuery";
import { queryCrowdfunding } from "../queries/CrowdfundingQuery";
import { queryEntities } from "../queries/EntityQuery";
import { queryFacts } from "../queries/FactsQuery";
import { queryFilings } from "../queries/FilingQuery";
import { queryOfferings } from "../queries/OfferingQuery";
import { queryPersons } from "../queries/PersonQuery";

const FORMAT_CHOICES = ["table", "json", "csv"] as const;
type OutputFormat = (typeof FORMAT_CHOICES)[number];

function validateFormat(value: string): OutputFormat {
  if (!FORMAT_CHOICES.includes(value as OutputFormat)) {
    throw new Error(`Invalid --format "${value}". Must be one of: ${FORMAT_CHOICES.join(", ")}.`);
  }
  return value as OutputFormat;
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
    .action(async (name: string, options: Record<string, unknown>) => {
      const limit = options.limit as number;
      const offset = options.offset as number;
      const format = validateFormat(options.format as string);
      const result = await queryCiks({
        name,
        exact: Boolean(options.exact),
        limit,
        offset,
      });

      const columns = [
        { key: "cik", header: "CIK", width: 10 },
        { key: "name", header: "Name", width: 60 },
      ];

      console.log(
        renderTable(result.rows as Record<string, unknown>[], columns, {
          format,
          total: result.total,
          offset,
          limit,
        })
      );

      if (result.tableEmpty && format === "table") {
        console.log(
          "\nThe cik_names table is empty. Run `sec bootstrap ingest cik-names` to populate it."
        );
      }
    });

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
    .action(async (search: string | undefined, options: Record<string, unknown>) => {
      const limit = options.limit as number;
      const offset = options.offset as number;
      const format = validateFormat(options.format as string);
      const result = await queryEntities({
        search,
        cik: options.cik ? parseInt(options.cik as string, 10) : undefined,
        sic: options.sic ? parseInt(options.sic as string, 10) : undefined,
        state: options.state as string | undefined,
        limit,
        offset,
        sort: options.sort as string | undefined,
      });

      const columns = [
        { key: "cik", header: "CIK", width: 10 },
        { key: "name", header: "Name", width: 30 },
        { key: "sic", header: "SIC", width: 6 },
        { key: "state_incorporation", header: "State", width: 5 },
      ];

      console.log(
        renderTable(result.rows as Record<string, unknown>[], columns, {
          format,
          total: result.total,
          offset,
          limit,
        })
      );
    });

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
    .action(async (search: string | undefined, options: Record<string, unknown>) => {
      const limit = options.limit as number;
      const offset = options.offset as number;
      const format = validateFormat(options.format as string);
      const result = await queryFilings({
        search,
        cik: options.cik ? parseInt(options.cik as string, 10) : undefined,
        form: options.form as string | undefined,
        after: options.after as string | undefined,
        before: options.before as string | undefined,
        limit,
        offset,
      });

      const columns = [
        { key: "cik", header: "CIK", width: 10 },
        { key: "accession_number", header: "Accession", width: 20 },
        { key: "form", header: "Form", width: 8 },
        { key: "filing_date", header: "Filed", width: 12 },
        { key: "primary_doc", header: "Document", width: 25 },
      ];

      console.log(
        renderTable(result.rows as Record<string, unknown>[], columns, {
          format,
          total: result.total,
          offset,
          limit,
        })
      );
    });

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
    .action(async (search: string | undefined, options: Record<string, unknown>) => {
      const limit = options.limit as number;
      const offset = options.offset as number;
      const format = validateFormat(options.format as string);
      const result = await queryOfferings({
        search,
        cik: options.cik ? parseInt(options.cik as string, 10) : undefined,
        industry: options.industry as string | undefined,
        exemption: options.exemption as string | undefined,
        after: options.after as string | undefined,
        before: options.before as string | undefined,
        limit,
        offset,
      });

      const columns = [
        { key: "cik", header: "CIK", width: 10 },
        { key: "file_number", header: "File #", width: 12 },
        { key: "industry_group", header: "Industry", width: 20 },
        { key: "date_of_first_sale", header: "First Sale", width: 12 },
      ];

      console.log(
        renderTable(result.rows as Record<string, unknown>[], columns, {
          format,
          total: result.total,
          offset,
          limit,
        })
      );
    });

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
    .action(async (search: string | undefined, options: Record<string, unknown>) => {
      const limit = options.limit as number;
      const offset = options.offset as number;
      const format = validateFormat(options.format as string);
      const result = await queryCrowdfunding({
        search,
        cik: options.cik ? parseInt(options.cik as string, 10) : undefined,
        portal: options.portal ? parseInt(options.portal as string, 10) : undefined,
        after: options.after as string | undefined,
        before: options.before as string | undefined,
        limit,
        offset,
      });

      const columns = [
        { key: "cik", header: "CIK", width: 10 },
        { key: "name", header: "Name", width: 25 },
        { key: "filing_date", header: "Filed", width: 12 },
        { key: "status", header: "Status", width: 10 },
      ];

      console.log(
        renderTable(result.rows as Record<string, unknown>[], columns, {
          format,
          total: result.total,
          offset,
          limit,
        })
      );
    });

  query
    .command("facts <cik>")
    .description("Query company facts")
    .option("--name <name>", "Filter by fact name")
    .option("--taxonomy <taxonomy>", "Filter by taxonomy")
    .option("--year <year>", "Filter by year", parseIntOption)
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(async (cik: string, options: Record<string, unknown>) => {
      const limit = options.limit as number;
      const offset = options.offset as number;
      const format = validateFormat(options.format as string);
      const result = await queryFacts({
        cik: parseInt(cik, 10),
        name: options.name as string | undefined,
        taxonomy: options.taxonomy as string | undefined,
        year: options.year as number | undefined,
        limit,
        offset,
      });

      const columns = [
        { key: "name", header: "Fact", width: 25 },
        { key: "val", header: "Value", width: 15 },
        { key: "val_unit", header: "Unit", width: 10 },
        { key: "fy", header: "FY", width: 6 },
        { key: "fp", header: "FP", width: 4 },
        { key: "filed_date", header: "Filed", width: 12 },
      ];

      console.log(
        renderTable(result.rows as Record<string, unknown>[], columns, {
          format,
          total: result.total,
          offset,
          limit,
        })
      );
    });

  query
    .command("persons [search]")
    .description("Search persons in the database")
    .option("--cik <cik>", "Filter by CIK")
    .option("--relationship <relationship>", "Filter by relationship")
    .option("--limit <n>", "Limit results", parseIntOption, 25)
    .option("--offset <n>", "Offset results", parseIntOption, 0)
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(async (search: string | undefined, options: Record<string, unknown>) => {
      const limit = options.limit as number;
      const offset = options.offset as number;
      const format = validateFormat(options.format as string);
      const result = await queryPersons({
        search,
        cik: options.cik ? parseInt(options.cik as string, 10) : undefined,
        relationship: options.relationship as string | undefined,
        limit,
        offset,
      });

      const columns = [
        { key: "first_name", header: "First", width: 15 },
        { key: "last_name", header: "Last", width: 20 },
        { key: "title", header: "Title", width: 20 },
        { key: "source_filing_issuer_cik", header: "CIK", width: 10 },
      ];

      console.log(
        renderTable(result.rows as Record<string, unknown>[], columns, {
          format,
          total: result.total,
          offset,
          limit,
        })
      );
    });
}
