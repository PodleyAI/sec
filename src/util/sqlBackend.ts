/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { isDryRun } from "../cli/isDryRun";
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
 * Two guards force the repository path regardless of the configured backend:
 *
 * - **Dry run.** `createStorage` enforces `--dry-run` by wrapping each storage
 *   in `ReadOnlyTabularStorage`, whose writes no-op and whose reads forward. A
 *   raw-SQL path goes around that wrapper and would commit for real, so it must
 *   not be taken. The wrapper forwards no `isDurable`, so the durability guard
 *   below cannot stand in for this one.
 * - **A non-durable repo.** An in-memory store is invisible to `getDb()` /
 *   `getPgPool()`, so a fast path would read from (or write to) an entirely
 *   different store. **Pass `repo` whenever you have one** — this is reachable
 *   in a single process, not just across test files: `EnvToDI` defaults
 *   `SEC_DB_TYPE` to `"sqlite"` and `.env.test` supplies `SEC_DB_FOLDER` /
 *   `SEC_DB_NAME` to the test workers, so anything that runs `EnvToDI` (or a CLI
 *   preAction hook) while holding an in-memory repo satisfies every token check
 *   below. Across test *files* the registry is clean —
 *   `resetDependencyInjectionsForTesting` strips these tokens and vitest runs
 *   `isolate: true` with `pool: "forks"` — so the guard is about in-process
 *   mixing, not leakage.
 *
 * Otherwise `"sqlite"` additionally requires the FULL production config, not
 * just the type token: `getDb()` dereferences both `SEC_DB_FOLDER` and
 * `SEC_DB_NAME` unconditionally, so a unit test that registers a repo without
 * standing up a real database must fall through rather than crash.
 */
export function resolveSqlBackend(repo?: MaybeDurable): SqlBackend {
  if (isDryRun()) return "repository";
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
