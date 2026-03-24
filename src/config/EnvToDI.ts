/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  SEC_DB_FOLDER,
  SEC_DB_NAME,
  SEC_DB_TYPE,
  SEC_PG_DATABASE,
  SEC_PG_HOST,
  SEC_PG_PASSWORD,
  SEC_PG_PORT,
  SEC_PG_URL,
  SEC_PG_USER,
  SEC_RAW_DATA_FOLDER,
} from "./tokens";

/** Thrown when required env/DI setup is missing; the CLI entrypoint prints only the message (no stack). */
export class SecCliConfigurationError extends Error {
  override readonly name = "SecCliConfigurationError";
  constructor(message: string) {
    super(message);
  }
}

export const EnvToDI = (): void => {
  // TODO(str): we should use dotenv to work on node
  if (process.env.SEC_RAW_DATA_FOLDER) {
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, process.env.SEC_RAW_DATA_FOLDER);
  }
  if (process.env.SEC_DB_FOLDER) {
    globalServiceRegistry.registerInstance(SEC_DB_FOLDER, process.env.SEC_DB_FOLDER);
  }
  if (process.env.SEC_DB_NAME) {
    globalServiceRegistry.registerInstance(SEC_DB_NAME, process.env.SEC_DB_NAME);
  }

  const dbType = process.env.SEC_DB_TYPE ?? "sqlite";
  if (dbType !== "sqlite" && dbType !== "postgres") {
    throw new Error(`Invalid SEC_DB_TYPE "${dbType}". Must be "sqlite" or "postgres".`);
  }
  globalServiceRegistry.registerInstance(SEC_DB_TYPE, dbType);

  if (process.env.SEC_PG_URL) {
    globalServiceRegistry.registerInstance(SEC_PG_URL, process.env.SEC_PG_URL);
  }
  if (process.env.SEC_PG_HOST) {
    globalServiceRegistry.registerInstance(SEC_PG_HOST, process.env.SEC_PG_HOST);
  }
  if (process.env.SEC_PG_PORT) {
    globalServiceRegistry.registerInstance(SEC_PG_PORT, process.env.SEC_PG_PORT);
  }
  if (process.env.SEC_PG_USER) {
    globalServiceRegistry.registerInstance(SEC_PG_USER, process.env.SEC_PG_USER);
  }
  if (process.env.SEC_PG_PASSWORD) {
    globalServiceRegistry.registerInstance(SEC_PG_PASSWORD, process.env.SEC_PG_PASSWORD);
  }
  if (process.env.SEC_PG_DATABASE) {
    globalServiceRegistry.registerInstance(SEC_PG_DATABASE, process.env.SEC_PG_DATABASE);
  }

  assertSecCliEnvConfigured();
};

/**
 * Fails fast with an actionable message when required env was never applied to the DI registry.
 * (A bare `Service not registered: sec.db.folder` from the container is easy to misread.)
 */
function assertSecCliEnvConfigured(): void {
  const dbType = globalServiceRegistry.get(SEC_DB_TYPE);
  if (dbType !== "sqlite") {
    return;
  }
  if (globalServiceRegistry.has(SEC_DB_FOLDER) && globalServiceRegistry.has(SEC_DB_NAME)) {
    return;
  }
  throw new SecCliConfigurationError(
    "SEC CLI is not configured; run `init` before commands like `bootstrap`."
  );
}
