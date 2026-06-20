/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Detects a UNIQUE-index violation thrown by `@workglow/storage` backends.
 *
 * All three backends (InMemory, SQLite, Postgres) surface the violation as
 * a `StorageError` whose message starts with `"UNIQUE constraint failed"`.
 * We match on the message rather than `instanceof StorageError` so that
 * future wrappers / re-thrown errors continue to be recognised; the
 * message prefix is stable across backends.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" && msg.startsWith("UNIQUE constraint failed");
}
