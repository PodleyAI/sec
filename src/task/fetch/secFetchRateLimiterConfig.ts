/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RateLimiterStorageOptions } from "workglow";

/**
 * The single configuration sec builds its Postgres rate-limiter storage from.
 *
 * No prefix columns: every process shares ONE EDGAR fetch budget, so there is
 * nothing to shard the reservation window by. Sharding it later (a column per
 * host, per queue, …) is a matter of adding prefixes here — which also renames
 * the storage's tables, which is why `db setup` and `db reset` both go through
 * {@link secFetchRateLimiterTableNames} rather than naming them literally.
 */
export const SecFetchRateLimiterOptions: RateLimiterStorageOptions = {
  prefixes: [],
  prefixValues: {},
};

/**
 * The tables `PostgresRateLimiterStorage` creates for a given configuration.
 *
 * That class derives its table names from its prefix columns and exposes
 * neither the names nor the derivation, so a caller cannot ask what it built.
 * This mirrors the derivation of the installed version; `resetAllDatabases`
 * has to know the names to drop them, and a copy that silently disagreed would
 * leave stale execution rows behind — so the copy is pinned by a test that
 * runs the storage's own migrations and compares the emitted DDL.
 */
export function rateLimiterStorageTableNames(
  options: RateLimiterStorageOptions
): ReadonlyArray<string> {
  const prefixes = options.prefixes ?? [];
  const suffix = prefixes.length > 0 ? `_${prefixes.map((p) => p.name).join("_")}` : "";
  return [`rate_limit_executions${suffix}`, `rate_limit_next_available${suffix}`];
}

/** The rate-limiter tables sec's own configuration creates, i.e. what a reset owns. */
export function secFetchRateLimiterTableNames(): ReadonlyArray<string> {
  return rateLimiterStorageTableNames(SecFetchRateLimiterOptions);
}
