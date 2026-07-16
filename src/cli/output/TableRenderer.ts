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
// Strip only space-like characters that spreadsheets silently ignore before
// formula parsing. Excludes \t and \r — those are themselves dangerous
// formula leads and are caught by DANGEROUS_LEAD.
//
// All entries are written as `\uXXXX` escape sequences. Source-level raw
// NBSP / zero-width characters are silently normalised by many editors,
// which would defang this regex without anyone noticing in code review.
//
// Codepoint coverage (informal):
//   U+0020 SPACE
//   U+00A0 NO-BREAK SPACE (NBSP)
//   U+00AD SOFT HYPHEN (SHY)
//   U+034F COMBINING GRAPHEME JOINER (CGJ)
//   U+061C ARABIC LETTER MARK (ALM)
//   U+115F HANGUL CHOSEONG FILLER (invisible)
//   U+1160 HANGUL JONGSEONG FILLER (invisible)
//   U+1680 OGHAM SPACE MARK
//   U+180E MONGOLIAN VOWEL SEPARATOR
//   U+2000..U+200A en/em/figure/hair/etc. spaces
//   U+200B..U+200F ZWSP / ZWNJ / ZWJ / LRM / RLM
//   U+2028 LINE SEPARATOR (Zl) — not matched by JS `\n`, so it never
//          gets split into a separate line by escapeCsvValue. Strip
//          it here so a leading ` =cmd` payload (where  is
//          U+2028) can't slip past the formula-lead check.
//   U+2029 PARAGRAPH SEPARATOR (Zp) — same rationale as U+2028.
//   U+202A..U+202E bidi formatting (LRE/RLE/PDF/LRO/RLO)
//   U+202F NARROW NO-BREAK SPACE
//   U+205F MEDIUM MATHEMATICAL SPACE
//   U+2060..U+2064 WORD JOINER / invisible operators
//   U+206A..U+206F deprecated invisible formatting
//   U+3000 IDEOGRAPHIC SPACE
//   U+3164 HANGUL FILLER
//   U+FEFF ZERO WIDTH NO-BREAK SPACE / BOM
//   U+FFA0 HALFWIDTH HANGUL FILLER
const LEADING_WS =
  /^[\u0020\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u180E\u2000-\u200F\u2028\u2029\u202A-\u202F\u205F\u2060-\u2064\u206A-\u206F\u3000\u3164\uFEFF\uFFA0]+/;

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
 *      RLM, BOM, narrow/medium math spaces, ideographic/Hangul fillers,
 *      bidi formatting). Tab and CR are themselves dangerous leads and
 *      are NOT stripped here — they're handled by DANGEROUS_LEAD.
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
  const defused = parts.map((part, i) => (i % 2 === 0 ? defuseLine(part) : part)).join("");
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
  // A list-valued column (e.g. a person's `titles`) reads as "A, B" rather than
  // the comma-jammed default String(Array) form; CSV escaping runs afterwards.
  if (Array.isArray(v)) {
    return v.join(", ");
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
      lines.push(`(streamed; narrow the filter for an exact count and full pagination)`);
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
