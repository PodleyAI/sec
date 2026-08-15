/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Escapes an identifier for interpolation between double quotes.
 *
 * Postgres identifiers are quoted with `"` and a literal `"` inside one is
 * written `""`. Every raw-DDL call site here builds `"${quote(name)}"` rather
 * than passing the name as a bind parameter, because DDL cannot parameterize an
 * identifier.
 */
export function quote(identifier: string): string {
  return identifier.replace(/"/g, '""');
}

/**
 * The schema sec's tables live in — the one `CREATE TABLE` writes to, i.e. the
 * first entry on the connection's `search_path`.
 *
 * Raw DDL must be qualified with it. An unqualified name resolves through the
 * whole search path, so a statement naming a table that is absent from the
 * current schema but present in the NEXT one on the path silently reaches the
 * wrong database objects — the hazard `db reset` already qualifies against, and
 * the same hazard applies to an `ALTER TABLE`.
 *
 * @param context Prefixed onto the error message so the caller's command names
 * itself (`db setup` / `db reset`) when the connection has no current schema.
 */
export async function currentSchemaName(
  client: {
    query: (sql: string) => Promise<{ rows: { name: string }[] }>;
  },
  context: string
): Promise<string> {
  const result = await client.query("SELECT current_schema() AS name");
  const name = result.rows[0]?.name;
  if (!name) {
    throw new Error(`${context}: the connection has no current schema (empty search_path).`);
  }
  return name;
}
