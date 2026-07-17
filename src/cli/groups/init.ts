import type { Command } from "commander";
import { existsSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { createInterface } from "readline";
import { globalServiceRegistry } from "workglow";
import { SEC_DRY_RUN, SEC_JSON_OUTPUT } from "../../config/tokens";
import { InitApplyTask, buildEnvConfig, type InitConfig } from "../../task/init/InitApplyTask";
import { parseGlobalOptions } from "../GlobalOptions";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";

export { buildEnvConfig };
export type { InitConfig };

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export function addInitCommand(parent: Command): void {
  parent
    .command("init")
    .description("Interactive first-run setup wizard")
    .action(async () => {
      const globalOpts = parseGlobalOptions(parent);
      const dryRun = globalOpts.dryRun;
      globalServiceRegistry.registerInstance(SEC_DRY_RUN, dryRun);
      globalServiceRegistry.registerInstance(SEC_JSON_OUTPUT, globalOpts.json);

      await runCommand(async () => {
        const envPath = resolve(process.cwd(), ".env.local");

        if (existsSync(envPath)) {
          console.warn("Warning: .env.local already exists. Continuing will overwrite it.");
        }

        const rl = createInterface({ input: process.stdin, output: process.stdout });

        try {
          const defaultDbFolder = resolve(homedir(), ".sec/data");
          const defaultRawFolder = resolve(homedir(), ".sec/raw");

          const dbTypeAnswer = await prompt(rl, "Database type (sqlite or postgres) [sqlite]: ");
          const dbType = dbTypeAnswer === "postgres" ? "postgres" : "sqlite";

          const dbFolder =
            (await prompt(rl, `Database folder [${defaultDbFolder}]: `)) || defaultDbFolder;

          const dbName = (await prompt(rl, "Database name [edgar]: ")) || "edgar";

          const rawDataFolder =
            (await prompt(rl, `Raw data folder [${defaultRawFolder}]: `)) || defaultRawFolder;

          let pgFields: Partial<InitConfig> = {};

          if (dbType === "postgres") {
            const useUrl = await prompt(rl, "Use a connection string? (y/n) [n]: ");

            if (useUrl.toLowerCase() === "y") {
              const pgUrl = await prompt(rl, "PostgreSQL connection string: ");
              pgFields = { pgUrl };
            } else {
              const pgHost = (await prompt(rl, "PostgreSQL host [localhost]: ")) || "localhost";
              const pgPort = (await prompt(rl, "PostgreSQL port [5432]: ")) || "5432";
              const pgUser = await prompt(rl, "PostgreSQL user: ");
              const pgPassword = await prompt(rl, "PostgreSQL password: ");
              const pgDatabase = (await prompt(rl, "PostgreSQL database [edgar]: ")) || "edgar";

              pgFields = { pgHost, pgPort, pgUser, pgPassword, pgDatabase };
            }
          }

          const config: InitConfig = {
            dbType,
            dbFolder,
            dbName,
            rawDataFolder,
            ...pgFields,
          };

          if (dryRun) {
            console.log(`Would write ${envPath}:`);
            console.log(buildEnvConfig(config));
            console.log(`Would create directory: ${dbFolder}`);
            console.log(`Would create directory: ${rawDataFolder}`);
            console.log("Would create database tables.");
            return;
          }

          await runWorkflowCli([new InitApplyTask({ defaults: { ...config, envPath } })]);

          console.log("\nSetup complete! Next steps:");
          console.log("  sec db status                    — verify database connection");
          console.log("  sec bootstrap download ciks      — download the CIK name lookup");
          console.log("  sec bootstrap ingest cik-names   — load CIK names into the database");
        } finally {
          rl.close();
        }
      });
    });
}
