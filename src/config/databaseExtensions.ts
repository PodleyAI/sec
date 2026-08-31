/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AnyTabularStorage, ServiceToken } from "workglow";

const TOKENS: ServiceToken<AnyTabularStorage>[] = [];

/** Register downstream repo tokens so `db setup`/`reset` create/drop their tables. */
export function registerDatabaseExtension(
  tokens: readonly ServiceToken<AnyTabularStorage>[]
): void {
  for (const t of tokens) {
    if (!TOKENS.includes(t)) TOKENS.push(t);
  }
}

export function listDatabaseExtensionTokens(): readonly ServiceToken<AnyTabularStorage>[] {
  return TOKENS;
}

type SetupHook = () => void;
const SETUP_HOOKS: SetupHook[] = [];

/**
 * Register a hook `setupAllDatabases()` runs (after `EnvToDI`, before it creates
 * tables and seeds component versions) so a downstream package can register its
 * DI repos + `registerDatabaseExtension` tokens + `registerResolverExtension`
 * kinds in time. This is what makes downstream tables/resolvers materialize on
 * the `init` path too, which bypasses the CLI preAction hook. Idempotent.
 */
export function registerDatabaseSetupHook(hook: SetupHook): void {
  if (!SETUP_HOOKS.includes(hook)) SETUP_HOOKS.push(hook);
}

/** Run every registered setup hook. Called by `setupAllDatabases()`. */
export function runDatabaseSetupHooks(): void {
  for (const hook of SETUP_HOOKS) hook();
}

/**
 * SQL views a package contributes over its own tables.
 *
 * Separate from {@link registerDatabaseSetupHook} because of when each runs: a
 * setup hook fires BEFORE tables exist, to register repos and tokens, while a
 * view is DDL over tables that must already be there. Registering views through
 * the hook would create them against nothing.
 *
 * `names` is what `db reset` drops, and it is given rather than parsed out of
 * the DDL so a view whose definition changes shape is still dropped by name.
 */
export interface DatabaseViews {
  readonly ddl: readonly string[];
  readonly names: readonly string[];
}

const VIEWS = new Map<string, DatabaseViews>();

/**
 * Contribute views created after `db setup` builds tables, dropped by `db reset`.
 *
 * Idempotent on the view NAMES, not on the object handed in. A caller builds its
 * argument at the call site — `registerDatabaseViews({ ddl, names })` — so a
 * fresh object arrives on every call and an identity check would never fire.
 * That matters because the registering function is itself called twice in one
 * process, by the CLI preAction hook and again by the database setup hook: with
 * an identity check the same views would be created and dropped once per call
 * and the list would grow for the life of the process.
 */
export function registerDatabaseViews(views: DatabaseViews): void {
  VIEWS.set([...views.names].join("\u0000"), views);
}

export function listDatabaseViewDdl(): readonly string[] {
  return [...VIEWS.values()].flatMap((v) => v.ddl);
}

export function listDatabaseViewNames(): readonly string[] {
  return [...VIEWS.values()].flatMap((v) => v.names);
}

/**
 * Drop every registered token, setup hook and view. All three registries are
 * module-level, so they survive any rebuild of the DI container they were
 * registered against — which is why `resetDependencyInjectionsForTesting()`
 * calls this rather than leaving each test file to remember it.
 */
export function clearDatabaseExtensionsForTesting(): void {
  TOKENS.length = 0;
  SETUP_HOOKS.length = 0;
  VIEWS.clear();
}
