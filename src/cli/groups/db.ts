import type { Command } from "commander";
import type { DbStatusResult } from "../queries/DbStatus";
import { DbResetTask } from "../../task/db/DbResetTask";
import { DbSetupTask } from "../../task/db/DbSetupTask";
import { DbStatsTask, type DbStatsTaskOutput } from "../../task/db/DbStatsTask";
import { DbStatusTask } from "../../task/db/DbStatusTask";
import { renderTable } from "../output/TableRenderer";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";

export function addDbCommands(program: Command): void {
  const db = program.command("db").description("Database management commands");

  db.command("setup")
    .description("Create or migrate all database tables")
    .action(async () => {
      await runCommand(async () => {
        await runWorkflowCli([new DbSetupTask()]);
      });
    });

  db.command("status")
    .description("Show database connection status")
    .option("--format <format>", "Output format (table, json)", "table")
    .option("--exact", "Use exact counts instead of fast Postgres estimates")
    .action(async (options: { format?: string; exact?: boolean }) => {
      await runCommand(async () => {
        const status = await runWorkflowCli<DbStatusResult>([
          new DbStatusTask({ defaults: { exact: options.exact === true } }),
        ]);

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
        console.log(`  Extractor Runs:        ${fmt(status.extractorRuns)}`);
      });
    });

  db.command("stats")
    .description("Show row counts and database size")
    .option("--format <format>", "Output format (table, json)", "table")
    .option("--exact", "Use exact counts instead of fast Postgres estimates")
    .action(async (options: { format?: string; exact?: boolean }) => {
      await runCommand(async () => {
        const { tables } = await runWorkflowCli<DbStatsTaskOutput>([
          new DbStatsTask({ defaults: { exact: options.exact === true } }),
        ]);

        const columns = [
          { key: "table", header: "Table", width: 25 },
          { key: "rows", header: "Rows", width: 12 },
        ];

        const format = (options.format as "table" | "json") ?? "table";
        // A null count means the relation does not exist yet. JSON keeps the
        // null (a consumer must be able to tell "not counted" from zero); the
        // text table would render it as an empty cell, so label it.
        const rendered =
          format === "json"
            ? (tables as unknown as Record<string, unknown>[])
            : tables.map((stat) => ({ table: stat.table, rows: stat.rows ?? "n/a" }));

        console.log(renderTable(rendered, columns, { format }));

        const missing = tables.filter((stat) => stat.rows === null).length;
        if (missing > 0 && format !== "json") {
          console.log(`\n${missing} table(s) not counted (n/a) — run \`db setup\`?`);
        }
      });
    });

  db.command("reset")
    .description("Drop and recreate the tables sec owns")
    .option("--confirm", "Required flag to confirm destructive operation")
    .option("--cascade", "Also drop objects that depend on sec's tables (e.g. custom views)")
    .option(
      "--drop-schema",
      "Postgres only: drop and recreate the entire schema, including objects sec does not own"
    )
    .action(async (options) => {
      if (!options.confirm) {
        console.error("Pass --confirm to drop and recreate the tables sec owns.");
        process.exitCode = 1;
        return;
      }
      await runCommand(async () => {
        await runWorkflowCli([
          new DbResetTask({
            defaults: {
              cascade: options.cascade === true,
              dropSchema: options.dropSchema === true,
            },
          }),
        ]);
        console.log("Database reset complete.");
      });
    });
}
