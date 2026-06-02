export interface ColumnDef {
  readonly key: string;
  readonly header: string;
  readonly width: number;
}

export interface RenderOptions {
  readonly format: "table" | "csv" | "json";
  readonly total?: number;
  readonly offset?: number;
  readonly limit?: number;
  /**
   * Set when the displayed `total` is a lower bound — the underlying
   * query streamed and stopped after collecting offset+limit matches
   * without exhausting the dataset. Its PRESENCE marks `total` as
   * approximate; rendered as "≥ N" with a hint to narrow the filter.
   */
  readonly totalApprox?: {
    readonly atLeast: number;
  };
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  if (width <= 3) {
    return "...".slice(0, width);
  }
  return value.slice(0, width - 3) + "...";
}

function pad(value: string, width: number): string {
  return truncate(value, width).padEnd(width);
}

// Characters that trigger formula interpretation when found at the start of a
// spreadsheet cell. See OWASP CSV Injection
// (https://owasp.org/www-community/attacks/CSV_Injection).
const DANGEROUS_LEAD = /^[=+\-@\t\r]/;
// Strip only space-like characters spreadsheets silently ignore.
// Excludes \t and \r — those are themselves dangerous formula leads.
const LEADING_WS = /^[  ­​‌‍‎‏﻿]+/;

function needsFormulaPrefix(line: string): boolean {
  return DANGEROUS_LEAD.test(line.replace(LEADING_WS, ""));
}

function defuseLine(line: string): string {
  return needsFormulaPrefix(line) ? "'" + line : line;
}

/**
 * Defuse CSV/spreadsheet formula injection per OWASP CSV Injection guidance.
 *
 * When Excel/Sheets/Numbers open a CSV, a cell starting with =/+/-/@ (or TAB/CR
 * which some loaders strip) is interpreted as a formula and can exfiltrate data
 * via WEBSERVICE/HYPERLINK or run external commands. Prefixing a single quote
 * neutralizes the formula — spreadsheets render the apostrophe as a literal and
 * hide the prefix; plain CSV consumers see one extra leading apostrophe.
 *
 * The naive `^[=+\-@\t\r]` check has three bypasses we handle here:
 *   1. Leading ASCII whitespace (" =cmd...") plus other space-like chars
 *      that spreadsheets silently strip (NBSP, SHY, ZWSP, ZWNJ, ZWJ, LRM,
 *      RLM, BOM). Tab and CR are themselves dangerous leads and are NOT
 *      stripped here.
 *   2. Dangerous char after an embedded newline in a quoted multi-line cell
 *      ("safe\n=cmd") — each physical line is re-parsed.
 *   3. Bare CR (\r) as a line separator inside a quoted multi-line cell —
 *      the line after the CR also re-parses, so split on \r\n | \r | \n.
 *
 * Each line of the value is defused independently; the result is then RFC 4180
 * quoted if it contains a comma, quote, CR, or LF.
 */
function escapeCsvValue(value: string): string {
  if (value.length === 0) {
    return value;
  }
  // Capturing-group split preserves the separators at odd indices so we can
  // round-trip the exact line endings (LF, CRLF, or bare CR) the caller used.
  const parts = value.split(/(\r\n|\r|\n)/);
  const defused = parts
    .map((part, i) => (i % 2 === 0 ? defuseLine(part) : part))
    .join("");
  if (
    defused.includes(",") ||
    defused.includes('"') ||
    defused.includes("\n") ||
    defused.includes("\r")
  ) {
    return '"' + defused.replace(/"/g, '""') + '"';
  }
  return defused;
}

function cellValue(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (v === null || v === undefined) {
    return "";
  }
  return String(v);
}

function renderJson(rows: ReadonlyArray<Record<string, unknown>>): string {
  return JSON.stringify(rows, null, 2);
}

function renderCsv(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<ColumnDef>
): string {
  const header = columns.map((c) => escapeCsvValue(c.header)).join(",");
  const dataRows = rows.map((row) =>
    columns.map((c) => escapeCsvValue(cellValue(row, c.key))).join(",")
  );
  return [header, ...dataRows].join("\n");
}

function renderTextTable(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<ColumnDef>,
  options: RenderOptions
): string {
  const headerLine = columns.map((c) => pad(c.header, c.width)).join("  ");
  const separator = columns.map((c) => "-".repeat(c.width)).join("  ");
  const dataLines = rows.map((row) =>
    columns.map((c) => pad(cellValue(row, c.key), c.width)).join("  ")
  );

  const lines = [headerLine, separator, ...dataLines];

  if (options.total !== undefined) {
    const offset = options.offset ?? 0;
    const count = rows.length;
    const start = count === 0 ? 0 : offset + 1;
    const end = count === 0 ? 0 : offset + count;
    lines.push("");
    // The presence of totalApprox is the "approximate/capped, more may
    // exist" signal — total is a lower bound, so render "≥ N".
    const isApprox = options.totalApprox !== undefined;
    const totalLabel = isApprox ? `≥ ${options.total}` : `${options.total}`;
    lines.push(`Showing ${start}-${end} of ${totalLabel} results`);
    if (isApprox) {
      lines.push(
        `(streamed; narrow the filter for an exact count and full pagination)`
      );
    }

    if (count > 0 && end < options.total) {
      lines.push(`(use --offset ${end} for next page)`);
    }
  }

  return lines.join("\n");
}

export function renderTable(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<ColumnDef>,
  options: RenderOptions
): string {
  switch (options.format) {
    case "json":
      return renderJson(rows);
    case "csv":
      return renderCsv(rows, columns);
    case "table":
      return renderTextTable(rows, columns, options);
    default:
      return renderTextTable(rows, columns, options);
  }
}

// Exported for unit tests; not part of the module's public API.
export const __testing = { escapeCsvValue };
