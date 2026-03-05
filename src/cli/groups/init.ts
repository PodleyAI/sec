import type { Command } from "commander";
import { createInterface } from "readline";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { runCommand } from "../runCommand";

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

export function buildEnvConfig(config: InitConfig): string {
  const lines: string[] = [
    `SEC_DB_TYPE="${config.dbType}"`,
    `SEC_DB_FOLDER="${config.dbFolder}"`,
    `SEC_DB_NAME="${config.dbName}"`,
    `SEC_RAW_DATA_FOLDER="${config.rawDataFolder}"`,
  ];

  if (config.dbType === "postgres") {
    if (config.pgUrl) {
      lines.push(`SEC_PG_URL="${config.pgUrl}"`);
    } else {
      if (config.pgHost) lines.push(`SEC_PG_HOST="${config.pgHost}"`);
      if (config.pgPort) lines.push(`SEC_PG_PORT="${config.pgPort}"`);
      if (config.pgUser) lines.push(`SEC_PG_USER="${config.pgUser}"`);
      if (config.pgPassword) lines.push(`SEC_PG_PASSWORD="${config.pgPassword}"`);
      if (config.pgDatabase) lines.push(`SEC_PG_DATABASE="${config.pgDatabase}"`);
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

          rl.close();

          const envContent = buildEnvConfig(config);
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
