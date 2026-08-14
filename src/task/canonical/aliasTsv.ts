/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Export/import format for canonical aliases, shared by all four kinds
 * (person, company, sponsor-family, underwriter-family).
 *
 * **TSV, not CSV, deliberately.** These files hold company and person names,
 * which routinely contain commas — `Keefe, Bruyette & Woods, Inc.`,
 * `Frank R. Martire, Jr.` — and the repo's only CSV reader
 * (`editorialImport.ts`) splits on commas with no quoting, so a CSV export would
 * be silently unreadable for exactly the names an operator most needs to
 * restore. A tab never appears in a filed entity name.
 *
 * **Names are the payload; ids are a comment.** Alias rows are keyed by
 * canonical UUIDs, and the re-key ceremony that makes an export necessary is
 * precisely the thing that destroys those ids — so an export listing only ids
 * restores nothing. The ids are carried anyway, last, so a diff against a live
 * listing is possible while they still resolve.
 */

/** One exported alias: the pair as ids, as names, and why it was recorded. */
export interface AliasExportRow {
  readonly alias_canonical_id: string;
  readonly target_canonical_id: string;
  /** Display name of the alias side; null when the canonical row is gone. */
  readonly alias_name: string | null;
  /** Display name of the target side; null when the canonical row is gone. */
  readonly target_name: string | null;
  readonly reason: string | null;
}

/** One alias to re-create, as the `alias` commands take it. */
export interface AliasImportRow {
  readonly from: string;
  readonly into: string;
  readonly reason: string | undefined;
}

export const ALIAS_TSV_COLUMNS = [
  "alias_name",
  "target_name",
  "reason",
  "alias_id",
  "target_id",
] as const;

/**
 * A field with tabs and newlines flattened to spaces. Only `reason` is
 * free-text and it is operator-authored, so this is a guard against a pasted
 * newline breaking the row rather than a general escaping scheme — which is why
 * it is lossy rather than quoted.
 */
function cell(value: string | null): string {
  return (value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

/** The rows as a header line plus one tab-separated line each. */
export function formatAliasTsv(rows: readonly AliasExportRow[]): string {
  const lines = [ALIAS_TSV_COLUMNS.join("\t")];
  for (const row of rows) {
    lines.push(
      [
        cell(row.alias_name),
        cell(row.target_name),
        cell(row.reason),
        cell(row.alias_canonical_id),
        cell(row.target_canonical_id),
      ].join("\t")
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * One alias as a human-readable line: names first (the part an operator acts
 * on), then the ids, then the reason. An unresolved side prints `?` rather than
 * a blank so a wiped or orphaned reference is visible rather than looking like
 * an unnamed entity.
 */
export function formatAliasLine(row: AliasExportRow): string {
  const from = row.alias_name ?? "?";
  const into = row.target_name ?? "?";
  return [
    `${from} → ${into}`,
    `(${row.alias_canonical_id} → ${row.target_canonical_id})`,
    row.reason ?? "",
  ].join("\t");
}

export interface AliasTsvParse {
  readonly rows: readonly AliasImportRow[];
  /** Human-readable complaints, one per unusable line; never thrown. */
  readonly errors: readonly string[];
}

/**
 * Parses a {@link formatAliasTsv} file back into alias pairs.
 *
 * Columns are located by HEADER NAME, not position, so a file an operator
 * reordered or trimmed still imports. A row whose `alias_name` or `target_name`
 * is empty is reported rather than imported: the ids are no help after the wipe
 * that made the export necessary, and importing a half-identified pair would
 * either fail obscurely or alias the wrong entity.
 */
export function parseAliasTsv(text: string): AliasTsvParse {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { rows: [], errors: [] };

  const header = lines[0]!.split("\t").map((h) => h.trim());
  const col = (name: string): number => header.indexOf(name);
  const aliasIdx = col("alias_name");
  const targetIdx = col("target_name");
  if (aliasIdx < 0 || targetIdx < 0) {
    return {
      rows: [],
      errors: [
        `header must name "alias_name" and "target_name" columns (got: ${header.join(", ")})`,
      ],
    };
  }
  const reasonIdx = col("reason");

  const rows: AliasImportRow[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split("\t");
    const from = (parts[aliasIdx] ?? "").trim();
    const into = (parts[targetIdx] ?? "").trim();
    if (from === "" || into === "") {
      errors.push(`line ${i + 1}: missing alias_name or target_name — ${lines[i]!.trim()}`);
      continue;
    }
    const reason = reasonIdx >= 0 ? (parts[reasonIdx] ?? "").trim() : "";
    rows.push({ from, into, reason: reason === "" ? undefined : reason });
  }
  return { rows, errors };
}
