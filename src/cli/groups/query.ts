import type { Command } from "commander";
import { queryEntities } from "../queries/EntityQuery";
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
    .action(async () => {
      console.log("not yet implemented");
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
    .action(async () => {
      console.log("not yet implemented");
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
    .action(async () => {
      console.log("not yet implemented");
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
    .action(async () => {
      console.log("not yet implemented");
    });

  query
    .command("persons [search]")
    .description("Search persons in the database")
    .option("--cik <cik>", "Filter by CIK")
    .option("--role <role>", "Filter by role")
    .option("--limit <n>", "Limit results")
    .option("--offset <n>", "Offset results")
    .option("--format <format>", "Output format (table, json, csv)")
    .action(async () => {
      console.log("not yet implemented");
    });
}
