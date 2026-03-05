import type { Command } from "commander";
import { setupAllDatabases } from "../../config/setupAllDatabases";
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
    .action(async () => {
      console.log("not yet implemented");
    });

  db.command("stats")
    .description("Show row counts and database size")
    .action(async () => {
      console.log("not yet implemented");
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
      console.log("not yet implemented");
    });
}
