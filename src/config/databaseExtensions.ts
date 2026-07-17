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

export function clearDatabaseExtensionsForTesting(): void {
  TOKENS.length = 0;
}
