/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, writeFileSync } from "fs";
import { Type } from "typebox";
import { Sqlite, Task } from "workglow";
import { DefaultDI } from "../../config/DefaultDI";
import { EnvToDI } from "../../config/EnvToDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import type { TaskPorts } from "../taskPorts";

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

export interface InitApplyTaskInput extends InitConfig {
  readonly envPath: string;
}

export type InitApplyTaskOutput = {
  readonly envPath: string;
  readonly dbFolder: string;
  readonly rawDataFolder: string;
};

/**
 * Apply phase of the first-run setup wizard: writes `.env.local`, creates the
 * data folders, wires DI from the fresh env, and creates the database tables.
 */
export class InitApplyTask extends Task<TaskPorts<InitApplyTaskInput>, InitApplyTaskOutput> {
  static readonly type = "InitApplyTask";
  static readonly category = "SEC";
  static readonly title = "Apply first-run setup";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      envPath: Type.String(),
      dbType: Type.Union([Type.Literal("sqlite"), Type.Literal("postgres")]),
      dbFolder: Type.String(),
      dbName: Type.String(),
      rawDataFolder: Type.String(),
      pgUrl: Type.Optional(Type.String()),
      pgHost: Type.Optional(Type.String()),
      pgPort: Type.Optional(Type.String()),
      pgUser: Type.Optional(Type.String()),
      pgPassword: Type.Optional(Type.String()),
      pgDatabase: Type.Optional(Type.String()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      envPath: Type.String(),
      dbFolder: Type.String(),
      rawDataFolder: Type.String(),
    });
  }

  async execute(input: TaskPorts<InitApplyTaskInput>): Promise<InitApplyTaskOutput> {
    const { envPath, ...config } = input;

    writeFileSync(envPath, buildEnvConfig(config), "utf-8");
    console.log(`Wrote ${envPath}`);

    mkdirSync(config.dbFolder, { recursive: true });
    console.log(`Created directory: ${config.dbFolder}`);

    mkdirSync(config.rawDataFolder, { recursive: true });
    console.log(`Created directory: ${config.rawDataFolder}`);

    // Re-read env so DI picks up new values. Push every var the
    // wizard collected, including the Postgres set — assertSecCliEnvConfigured
    // now fails fast for a Postgres dbType with missing PG env, so
    // the wizard would crash immediately after writing .env.local
    // if we left these blank.
    process.env.SEC_DB_TYPE = config.dbType;
    process.env.SEC_DB_FOLDER = config.dbFolder;
    process.env.SEC_DB_NAME = config.dbName;
    process.env.SEC_RAW_DATA_FOLDER = config.rawDataFolder;
    if (config.pgUrl !== undefined) process.env.SEC_PG_URL = config.pgUrl;
    if (config.pgHost !== undefined) process.env.SEC_PG_HOST = config.pgHost;
    if (config.pgPort !== undefined) process.env.SEC_PG_PORT = config.pgPort;
    if (config.pgUser !== undefined) process.env.SEC_PG_USER = config.pgUser;
    if (config.pgPassword !== undefined) process.env.SEC_PG_PASSWORD = config.pgPassword;
    if (config.pgDatabase !== undefined) process.env.SEC_PG_DATABASE = config.pgDatabase;

    EnvToDI();
    if (config.dbType === "sqlite" && typeof Sqlite.init === "function") {
      await Sqlite.init();
    }
    DefaultDI();

    await setupAllDatabases();
    console.log("Database tables created.");

    return { envPath, dbFolder: config.dbFolder, rawDataFolder: config.rawDataFolder };
  }
}
