/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { isDryRun } from "../cli/isDryRun";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../config/tokens";

export type SqlBackend = "sqlite" | "postgres" | "repository";

/**
 * Whether the fast path about to be taken mutates rows. Stated explicitly at
 * every call site because it decides whether `--dry-run` applies: a dry run
 * must not commit, but it must still read at full speed.
 */
export type SqlAccess = "read" | "write";

/** Structural view of the one {@link ITabularStorage} member this dispatch reads. */
export interface MaybeDurable {
  isDurable?(): boolean;
}

/**
 * Which backend a raw-SQL fast path may target, or `"repository"` when it must
 * fall back to the `ITabularStorage` abstraction.
 *
 * Two guards force the repository path regardless of the configured backend:
 *
 * - **Dry run, for `access: "write"` only.** `createStorage` enforces
 *   `--dry-run` by wrapping each storage in `ReadOnlyTabularStorage`, whose
 *   writes no-op and whose reads forward. A raw-SQL write goes around that
 *   wrapper and would commit for real, so it must not be taken; the wrapper
 *   forwards no `isDurable`, so the durability guard below cannot stand in for
 *   this one. A raw-SQL **read** commits nothing, and demoting it would be a
 *   silent pessimisation — `listFilingDates` would stream the whole `filings`
 *   table instead of one indexed `SELECT DISTINCT`, and the observation-title
 *   `IN`-list would collapse back into an N+1 — so `access: "read"` keeps the
 *   fast path under dry run.
 * - **A non-durable repo.** An in-memory store is invisible to `getDb()` /
 *   `getPgPool()`, so a fast path would read from (or write to) an entirely
 *   different store. **Pass `repo` whenever you have one** (hence the required
 *   parameter — pass `undefined` only when there genuinely is no repo) — this
 *   is reachable in a single process, not just across test files: `EnvToDI`
 *   defaults `SEC_DB_TYPE` to `"sqlite"` and `.env.test` supplies
 *   `SEC_DB_FOLDER` / `SEC_DB_NAME` to the test workers, so anything that runs
 *   `EnvToDI` (or a CLI preAction hook) while holding an in-memory repo
 *   satisfies every token check below. Across test *files* the registry is
 *   clean — `resetDependencyInjectionsForTesting` strips these tokens and
 *   vitest runs `isolate: true` with `pool: "forks"` — so the guard is about
 *   in-process mixing, not leakage.
 *
 * Otherwise `"sqlite"` additionally requires the FULL production config, not
 * just the type token: `getDb()` dereferences both `SEC_DB_FOLDER` and
 * `SEC_DB_NAME` unconditionally, so a unit test that registers a repo without
 * standing up a real database must fall through rather than crash.
 */
export function resolveSqlBackend(access: SqlAccess, repo: MaybeDurable | undefined): SqlBackend {
  if (access === "write" && isDryRun()) return "repository";
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
