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

function escapeCsvValue(value: string): string {
  // Defuse CSV/spreadsheet formula injection. When Excel/Sheets/Numbers
  // open a CSV, a cell starting with =/+/-/@ (or with leading TAB/CR
  // that some loaders strip) is interpreted as a formula, which can
  // exfiltrate data via WEBSERVICE/HYPERLINK or run external commands.
  // Prefix a single quote — spreadsheets render it as a literal and hide
  // the prefix; plain CSV consumers see the original text with one
  // leading apostrophe, which is a small price for not shipping a known
  // attack vector.
  const dangerous = value.length > 0 && /^[=+\-@\t\r]/.test(value);
  let escaped = dangerous ? "'" + value : value;
  if (escaped.includes(",") || escaped.includes('"') || escaped.includes("\n")) {
    return '"' + escaped.replace(/"/g, '""') + '"';
  }
  return escaped;
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
