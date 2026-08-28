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
 * Drop every registered token and setup hook. Both arrays are module-level, so
 * they survive any rebuild of the DI container they were registered against —
 * which is why `resetDependencyInjectionsForTesting()` calls this rather than
 * leaving each test file to remember it.
 */
export function clearDatabaseExtensionsForTesting(): void {
  TOKENS.length = 0;
  SETUP_HOOKS.length = 0;
}
