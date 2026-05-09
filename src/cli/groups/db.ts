import type { Command } from "commander";
import { resetAllDatabases } from "../../config/resetAllDatabases";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { renderTable } from "../output/TableRenderer";
import { getDbStats, getDbStatus } from "../queries/DbStatus";
import { runCommand } from "../runCommand";

export function addDbCommands(program: Command): void {
  const db = program.command("db").description("Database management commands");

  db.command("setup")
    .description("Create or migrate all database tables")
    .action(async () => {
      await runCommand(async () => {
        await setupAllDatabases();
      });
    });

  db.command("status")
    .description("Show database connection status")
    .option("--format <format>", "Output format (table, json)", "table")
    .action(async (options: Record<string, string>) => {
      await runCommand(async () => {
        const status = await getDbStatus();

        if (options.format === "json") {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        const fmt = (n: number): string => n.toLocaleString();
        console.log("Database Status\n");
        console.log(`  Entities:              ${fmt(status.entityCount)}`);
        console.log(`  Filings:               ${fmt(status.filingCount)}`);
        console.log(`  Company Facts:         ${fmt(status.factsCount)}`);
        console.log(`  Processed Submissions: ${fmt(status.processedSubmissions)}`);
        console.log(`  Processed Facts:       ${fmt(status.processedFacts)}`);
        console.log(`  Processed Filings:     ${fmt(status.processedFilings)}`);
      });
    });

  db.command("stats")
    .description("Show row counts and database size")
    .option("--format <format>", "Output format (table, json)", "table")
    .action(async (options: Record<string, string>) => {
      await runCommand(async () => {
        const stats = await getDbStats();

        const columns = [
          { key: "table", header: "Table", width: 25 },
          { key: "rows", header: "Rows", width: 12 },
        ];

        console.log(
          renderTable(stats as unknown as Record<string, unknown>[], columns, {
            format: (options.format as "table" | "json") ?? "table",
          })
        );
      });
    });

  db.command("reset")
    .description("Drop and recreate all tables")
    .option("--confirm", "Required flag to confirm destructive operation")
    .action(async (options) => {
      if (!options.confirm) {
        console.error("Pass --confirm to drop and recreate all tables.");
        process.exitCode = 1;
        return;
      }
      await runCommand(async () => {
        await resetAllDatabases();
        await setupAllDatabases();
        console.log("Database reset complete.");
      });
    });
}
