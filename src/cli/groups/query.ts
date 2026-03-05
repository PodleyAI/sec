import type { Command } from "commander";
import { queryEntities } from "../queries/EntityQuery";
import { queryFilings } from "../queries/FilingQuery";
import { queryOfferings } from "../queries/OfferingQuery";
import { queryCrowdfunding } from "../queries/CrowdfundingQuery";
import { queryFacts } from "../queries/FactsQuery";
import { queryPersons } from "../queries/PersonQuery";
import { renderTable } from "../output/TableRenderer";

export function addQueryCommands(program: Command): void {
  const query = program
    .command("query")
    .description("Query stored SEC data");

  query
    .command("entities [search]")
    .description("Search entities in the database")
    .option("--cik <cik>", "Filter by CIK")
    .option("--sic <sic>", "Filter by SIC code")
    .option("--state <state>", "Filter by state")
    .option("--limit <n>", "Limit results", "25")
    .option("--offset <n>", "Offset results", "0")
    .option("--sort <field>", "Sort by field")
    .option("--format <format>", "Output format (table, json, csv)", "table")
    .action(async (search: string | undefined, options: Record<string, string>) => {
      const limit = parseInt(options.limit);
      const offset = parseInt(options.offset);
      const result = await queryEntities({
        search,
        cik: options.cik ? parseInt(options.cik) : undefined,
        sic: options.sic ? parseInt(options.sic) : undefined,
        state: options.state,
        limit,
        offset,
        sort: options.sort,
      });

      const columns = [
        { key: "cik", header: "CIK", width: 10 },
        { key: "name", header: "Name", width: 30 },
        { key: "sic", header: "SIC", width: 6 },
        { key: "state_incorporation", header: "State", width: 5 },
      ];

      console.log(
        renderTable(result.rows as Record<string, unknown>[], columns, {
          format: options.format as "table" | "csv" | "json",
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
    .option("--limit <n>", "Limit results")
    .option("--offset <n>", "Offset results")
    .option("--format <format>", "Output format (table, json, csv)")
    .action(async (search: string | undefined, options: Record<string, string>) => {
      const limit = parseInt(options.limit ?? "25");
      const offset = parseInt(options.offset ?? "0");
      const result = await queryFilings({
        search,
        cik: options.cik ? parseInt(options.cik) : undefined,
        form: options.form,
        after: options.after,
        before: options.before,
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
          format: options.format as "table" | "csv" | "json",
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
    .option("--limit <n>", "Limit results")
    .option("--offset <n>", "Offset results")
    .option("--format <format>", "Output format (table, json, csv)")
    .action(async (search: string | undefined, options: Record<string, string>) => {
      const limit = parseInt(options.limit ?? "25");
      const offset = parseInt(options.offset ?? "0");
      const result = await queryOfferings({
        search,
        cik: options.cik ? parseInt(options.cik) : undefined,
        industry: options.industry,
        exemption: options.exemption,
        after: options.after,
        before: options.before,
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
          format: options.format as "table" | "csv" | "json",
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
    .option("--limit <n>", "Limit results")
    .option("--offset <n>", "Offset results")
    .option("--format <format>", "Output format (table, json, csv)")
    .action(async (search: string | undefined, options: Record<string, string>) => {
      const limit = parseInt(options.limit ?? "25");
      const offset = parseInt(options.offset ?? "0");
      const result = await queryCrowdfunding({
        search,
        cik: options.cik ? parseInt(options.cik) : undefined,
        portal: options.portal ? parseInt(options.portal) : undefined,
        after: options.after,
        before: options.before,
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
          format: options.format as "table" | "csv" | "json",
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
    .option("--year <year>", "Filter by year")
    .option("--limit <n>", "Limit results")
    .option("--offset <n>", "Offset results")
    .option("--format <format>", "Output format (table, json, csv)")
    .action(async (cik: string, options: Record<string, string>) => {
      const limit = parseInt(options.limit ?? "25");
      const offset = parseInt(options.offset ?? "0");
      const result = await queryFacts({
        cik: parseInt(cik),
        name: options.name,
        taxonomy: options.taxonomy,
        year: options.year ? parseInt(options.year) : undefined,
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
          format: options.format as "table" | "csv" | "json",
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
    .option("--role <role>", "Filter by role")
    .option("--limit <n>", "Limit results")
    .option("--offset <n>", "Offset results")
    .option("--format <format>", "Output format (table, json, csv)")
    .action(async (search: string | undefined, options: Record<string, string>) => {
      const limit = parseInt(options.limit ?? "25");
      const offset = parseInt(options.offset ?? "0");
      const result = await queryPersons({
        search,
        cik: options.cik ? parseInt(options.cik) : undefined,
        role: options.role,
        limit,
        offset,
      });

      const columns = [
        { key: "first", header: "First", width: 15 },
        { key: "last", header: "Last", width: 20 },
        { key: "title", header: "Title", width: 20 },
        { key: "cik", header: "CIK", width: 10 },
      ];

      console.log(
        renderTable(result.rows as Record<string, unknown>[], columns, {
          format: options.format as "table" | "csv" | "json",
          total: result.total,
          offset,
          limit,
        })
      );
    });
}
