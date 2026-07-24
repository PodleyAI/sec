/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, type ServiceToken } from "workglow";

export const SEC_RAW_DATA_FOLDER = createServiceToken<string>("sec.raw.data.folder");
export const SEC_DB_FOLDER = createServiceToken<string>("sec.db.folder");
export const SEC_DB_NAME = createServiceToken<string>("sec.db.name");
export const SEC_DB_TYPE = createServiceToken<"sqlite" | "postgres">("sec.db.type");
export const SEC_PG_URL = createServiceToken<string>("sec.pg.url");
export const SEC_PG_HOST = createServiceToken<string>("sec.pg.host");
export const SEC_PG_PORT = createServiceToken<string>("sec.pg.port");
export const SEC_PG_USER = createServiceToken<string>("sec.pg.user");
export const SEC_PG_PASSWORD = createServiceToken<string>("sec.pg.password");
export const SEC_PG_DATABASE = createServiceToken<string>("sec.pg.database");
export const SEC_DRY_RUN = createServiceToken<boolean>("sec.dry.run");
export const SEC_JSON_OUTPUT = createServiceToken<boolean>("sec.json.output");

/**
 * Every service token that env or CLI flags project into the DI container via
 * `EnvToDI.ts` (or the CLI preAction hook). `resetDependencyInjectionsForTesting`
 * strips them so a test file starts with a clean container — otherwise a value
 * registered by an earlier test file (e.g. `SEC_DRY_RUN = true`) leaks into
 * later files and silently changes behaviour under the shared registry.
 *
 * INVARIANT: any new env-derived token added to `EnvToDI.ts` (or set by a CLI
 * preAction hook) MUST also be appended here — otherwise
 * `resetDependencyInjectionsForTesting` will leave it dangling across test files.
 */
export const ENV_DERIVED_TOKENS: readonly ServiceToken<unknown>[] = [
  SEC_RAW_DATA_FOLDER,
  SEC_DB_TYPE,
  SEC_DB_FOLDER,
  SEC_DB_NAME,
  SEC_PG_URL,
  SEC_PG_HOST,
  SEC_PG_PORT,
  SEC_PG_USER,
  SEC_PG_PASSWORD,
  SEC_PG_DATABASE,
  SEC_DRY_RUN,
  SEC_JSON_OUTPUT,
] as readonly ServiceToken<unknown>[];
