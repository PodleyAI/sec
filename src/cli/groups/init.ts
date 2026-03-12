import type { Command } from "commander";
import { createInterface } from "readline";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { globalServiceRegistry } from "@workglow/util";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { parseGlobalOptions } from "../GlobalOptions";
import { runCommand } from "../runCommand";
import { SEC_DRY_RUN } from "../../config/tokens";

export interface InitConfig {
  readonly dbType: "sqlite" | "postgres";
  readonly dbFolder: string;
  readonly dbName: string;
  readonly rawDataFolder: string;
  readonly pgUrl?: string;
  readonly pgHost?: string;
  readonly pgPort?: string;
  readonly pgUser?: string;
  readonly pgPassword?: string;
  readonly pgDatabase?: string;
}

function escapeEnvValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function buildEnvConfig(config: InitConfig): string {
  const lines: string[] = [
    `SEC_DB_TYPE="${escapeEnvValue(config.dbType)}"`,
    `SEC_DB_FOLDER="${escapeEnvValue(config.dbFolder)}"`,
    `SEC_DB_NAME="${escapeEnvValue(config.dbName)}"`,
    `SEC_RAW_DATA_FOLDER="${escapeEnvValue(config.rawDataFolder)}"`,
  ];

  if (config.dbType === "postgres") {
    if (config.pgUrl) {
      lines.push(`SEC_PG_URL="${escapeEnvValue(config.pgUrl)}"`);
    } else {
      if (config.pgHost) lines.push(`SEC_PG_HOST="${escapeEnvValue(config.pgHost)}"`);
      if (config.pgPort) lines.push(`SEC_PG_PORT="${escapeEnvValue(config.pgPort)}"`);
      if (config.pgUser) lines.push(`SEC_PG_USER="${escapeEnvValue(config.pgUser)}"`);
      if (config.pgPassword) lines.push(`SEC_PG_PASSWORD="${escapeEnvValue(config.pgPassword)}"`);
      if (config.pgDatabase) lines.push(`SEC_PG_DATABASE="${escapeEnvValue(config.pgDatabase)}"`);
    }
  }

  return lines.join("\n") + "\n";
}

function prompt(
  rl: ReturnType<typeof createInterface>,
  question: string
): Promise<string> {
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
      const dryRun = parseGlobalOptions(parent).dryRun;
      globalServiceRegistry.registerInstance(SEC_DRY_RUN, dryRun);

      await runCommand(async () => {
        const envPath = resolve(process.cwd(), ".env.local");

        if (existsSync(envPath)) {
          console.warn("Warning: .env.local already exists. Continuing will overwrite it.");
        }

        const rl = createInterface({ input: process.stdin, output: process.stdout });

        try {
          const defaultDbFolder = resolve(homedir(), ".sec/data");
          const defaultRawFolder = resolve(homedir(), ".sec/raw");

          const dbTypeAnswer = await prompt(
            rl,
            "Database type (sqlite or postgres) [sqlite]: "
          );
          const dbType = dbTypeAnswer === "postgres" ? "postgres" : "sqlite";

          const dbFolder =
            (await prompt(rl, `Database folder [${defaultDbFolder}]: `)) || defaultDbFolder;

          const dbName = (await prompt(rl, 'Database name [edgar]: ')) || "edgar";

          const rawDataFolder =
            (await prompt(rl, `Raw data folder [${defaultRawFolder}]: `)) || defaultRawFolder;

          let pgFields: Partial<InitConfig> = {};

          if (dbType === "postgres") {
            const useUrl = await prompt(
              rl,
              "Use a connection string? (y/n) [n]: "
            );

            if (useUrl.toLowerCase() === "y") {
              const pgUrl = await prompt(rl, "PostgreSQL connection string: ");
              pgFields = { pgUrl };
            } else {
              const pgHost =
                (await prompt(rl, "PostgreSQL host [localhost]: ")) || "localhost";
              const pgPort = (await prompt(rl, "PostgreSQL port [5432]: ")) || "5432";
              const pgUser = await prompt(rl, "PostgreSQL user: ");
              const pgPassword = await prompt(rl, "PostgreSQL password: ");
              const pgDatabase =
                (await prompt(rl, "PostgreSQL database [edgar]: ")) || "edgar";

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

          const envContent = buildEnvConfig(config);

          if (dryRun) {
            console.log(`Would write ${envPath}:`);
            console.log(envContent);
            console.log(`Would create directory: ${dbFolder}`);
            console.log(`Would create directory: ${rawDataFolder}`);
            console.log("Would create database tables.");
            return;
          }

          writeFileSync(envPath, envContent, "utf-8");
          console.log(`Wrote ${envPath}`);

          mkdirSync(dbFolder, { recursive: true });
          console.log(`Created directory: ${dbFolder}`);

          mkdirSync(rawDataFolder, { recursive: true });
          console.log(`Created directory: ${rawDataFolder}`);

          // Re-read env so DI picks up new values
          process.env.SEC_DB_TYPE = config.dbType;
          process.env.SEC_DB_FOLDER = config.dbFolder;
          process.env.SEC_DB_NAME = config.dbName;
          process.env.SEC_RAW_DATA_FOLDER = config.rawDataFolder;

          await setupAllDatabases();
          console.log("Database tables created.");

          console.log("\nSetup complete! Next steps:");
          console.log("  sec db status          — verify database connection");
          console.log("  sec bootstrap cik      — download CIK name lookup");
          console.log("  sec bootstrap index    — download filing indexes");
        } finally {
          rl.close();
        }
      });
    });
}
