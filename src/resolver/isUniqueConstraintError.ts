/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Detects a UNIQUE-index violation thrown by `@workglow/storage` backends.
 *
 * Three backends in production today:
 *   - InMemory / SQLite — surface the violation as an `Error` whose message
 *     starts (case-insensitively) with `"UNIQUE constraint failed"`. SQLite
 *     additionally carries `code: "SQLITE_CONSTRAINT_UNIQUE"` on the native
 *     `better-sqlite3` error.
 *   - Postgres — propagates the raw `pg.DatabaseError` unmodified through
 *     `PostgresTabularStorage._putInternal`. It carries `code: "23505"`
 *     (SQLSTATE `unique_violation`) and a message of the form
 *     `"duplicate key value violates unique constraint \"<name>\""`. We match
 *     BOTH signals so the helper still fires if a future wrapper layer
 *     strips the SQLSTATE but preserves the message (or vice versa).
 *
 * We deliberately avoid `instanceof pg.DatabaseError` / `instanceof SqliteError`
 * — neither `pg` nor `better-sqlite3` is a direct dependency of `@workglow/sec`,
 * and string/code matching is robust to wrapped or re-thrown errors.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  const msg = (err as { message?: unknown }).message;
  if (typeof msg !== "string") return false;
  const lower = msg.toLowerCase();
  return (
    lower.startsWith("unique constraint failed") ||
    lower.includes("duplicate key value violates unique constraint")
  );
}
