/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../config/tokens";

export type SqlBackend = "sqlite" | "postgres" | "repository";

/** Structural view of the one {@link ITabularStorage} member this dispatch reads. */
interface MaybeDurable {
  isDurable?(): boolean;
}

/**
 * Which backend a raw-SQL fast path may target, or `"repository"` when it must
 * fall back to the `ITabularStorage` abstraction.
 *
 * The `"sqlite"` answer requires the FULL production config, not just the type
 * token: `getDb()` dereferences both `SEC_DB_FOLDER` and `SEC_DB_NAME`
 * unconditionally, so a unit test that registers a repo without standing up a
 * real database must fall through rather than crash.
 *
 * Pass `repo` whenever the caller has one. `SEC_DB_TYPE` lives in the global
 * ServiceRegistry, whose bindings persist for the process lifetime, so a token
 * registered by an earlier test file can otherwise route a test's in-memory
 * repo into a real SQLite/Postgres backend that was never set up. A non-durable
 * repo is the reliable signal that the fast path would hit the wrong store.
 */
export function resolveSqlBackend(repo?: MaybeDurable): SqlBackend {
  if (typeof repo?.isDurable === "function" && repo.isDurable() === false) return "repository";

  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;

  if (
    dbType === "sqlite" &&
    globalServiceRegistry.has(SEC_DB_FOLDER) &&
    globalServiceRegistry.has(SEC_DB_NAME)
  ) {
    return "sqlite";
  }
  if (dbType === "postgres") return "postgres";
  return "repository";
}
