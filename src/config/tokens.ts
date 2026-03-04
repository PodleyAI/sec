/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";

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
