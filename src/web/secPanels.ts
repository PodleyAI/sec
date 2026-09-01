/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebPanel, type PanelData, type WebInvocation } from "@workglow/cli";
import { count, field, recordArray, tableFromRecords, text } from "./secPanelFormat";

/**
 * The panels that read a sec command's own output.
 *
 * Every one of them renders what the run already returned — no panel queries
 * the database on its own. That is what keeps them honest: the panel and the
 * `--format json` output are the same data, so a figure on screen can always be
 * traced to the row the command actually read.
 */

const source = "@workglow/sec";

function pathIs(invocation: WebInvocation, ...path: readonly string[]): boolean {
  return (
    invocation.path.length === path.length &&
    path.every((segment, index) => invocation.path[index] === segment)
  );
}

function pathStartsWith(invocation: WebInvocation, ...prefix: readonly string[]): boolean {
  return prefix.every((segment, index) => invocation.path[index] === segment);
}

/**
 * The dead-letter worklist, coloured by the CLASS of failure each row records.
 *
 * The tone is a reading of the reason code and nothing more: amber where the
 * code is retryable under the extractor version that recorded it, red where it
 * is version-gated. It is deliberately NOT a verdict on whether a given row is
 * retryable right now — that also depends on whether the extractor version has
 * advanced past the row's `failed_extractor_version`, and this panel is built
 * from the command's `pending` output, which carries no current versions. A red
 * row whose version has since moved on IS eligible, and the note points at the
 * surface that can actually answer that rather than implying this one does.
 *
 * The amber set is bounded in a way the tone cannot show either:
 * `MIXED_CAPTION_SHAPE` is same-version retryable for a limited number of
 * attempts and then falls back to the version gate, which is why the `attempts`
 * column is rendered beside it.
 */
const SAME_VERSION_RETRYABLE: ReadonlySet<string> = new Set([
  "MODEL_RESOLUTION_ERROR",
  "RATE_LIMITED",
  "MIXED_CAPTION_SHAPE",
]);

function deadLetterPanel(output: unknown): PanelData {
  const pending = recordArray(field(output, "pending"));
  const eligible = recordArray(field(output, "eligibleByExtractor"));
  if (pending.length === 0 && eligible.length > 0) {
    return tableFromRecords(eligible, {
      columns: ["extractor_id", "count"],
      note: "Entries eligible for retry under the current extractor version.",
    });
  }
  if (pending.length === 0) {
    return {
      kind: "empty",
      message: "Nothing pending — every section either resolved or never failed.",
    };
  }
  return {
    kind: "table",
    columns: ["extractor", "section", "accession", "reason", "attempts", "failed at version"],
    rows: pending.map((entry) => [
      text(entry.extractor_id),
      entry.section_name === "" ? "(filing)" : text(entry.section_name),
      text(entry.accession_number),
      text(entry.reason_code),
      text(entry.attempts),
      text(entry.failed_extractor_version),
    ]),
    rowTones: pending.map((entry) =>
      SAME_VERSION_RETRYABLE.has(String(entry.reason_code)) ? "warn" : "fail"
    ),
    note: "Amber: the reason code is retryable under the version that recorded it. Red: version-gated — but a red row whose extractor has since been bumped is already eligible, which this view cannot see. `extractor dead-letters <id> --eligible` counts what is actually retryable now.",
  };
}

function versionStatusPanel(output: unknown): PanelData {
  const rows = recordArray(field(output, "rows")).concat(
    Array.isArray(output) ? recordArray(output) : []
  );
  if (rows.length === 0) return { kind: "empty", message: "No component versions recorded." };
  return {
    kind: "table",
    columns: ["kind", "id", "previous", "current", "next", "next coverage"],
    rows: rows.map((row) => [
      text(row.component_kind),
      text(row.component_id),
      text(row.previous),
      text(row.current),
      text(row.next),
      row.next === "—" ? "—" : row.next_coverage_complete ? "complete" : "incomplete",
    ]),
    // A dev cycle that is open but not yet covered is the one an operator is
    // looking for: it is what blocks a major promote.
    rowTones: rows.map((row) =>
      row.next !== "—" && row.next !== undefined
        ? row.next_coverage_complete
          ? "ok"
          : "warn"
        : undefined
    ),
  };
}

/**
 * Any query command's rows, as a table.
 *
 * One panel rather than fifteen: every `query` command returns the same
 * `{rows, total}` shape, and the columns are whatever the rows carry — so a
 * query added later is rendered without anyone registering anything.
 */
function queryRowsPanel(output: unknown): PanelData {
  const rows = recordArray(field(output, "rows"));
  const total = field(output, "total");
  const approx = field(output, "totalApprox");
  if (field(output, "tableEmpty") === true) {
    return {
      kind: "empty",
      message: "That table has no rows at all — run the matching `bootstrap ingest` first.",
    };
  }
  const totalText =
    typeof total === "number"
      ? `${approx ? "at least " : ""}${total.toLocaleString("en-US")} matching`
      : undefined;
  return tableFromRecords(rows, { note: totalText });
}

function dbStatsPanel(output: unknown): PanelData {
  const tables = recordArray(field(output, "tables"));
  if (tables.length > 0) {
    return {
      kind: "table",
      columns: ["table", "rows"],
      rows: tables.map((row) => [
        text(row.table),
        row.rows === null ? "n/a — run `db setup`?" : count(row.rows),
      ]),
      rowTones: tables.map((row) => (row.rows === null ? "warn" : undefined)),
      note: "Postgres row counts are catalog estimates unless --exact was passed.",
    };
  }
  const counts = [
    ["entities", field(output, "entityCount")],
    ["filings", field(output, "filingCount")],
    ["company facts", field(output, "factsCount")],
    ["processed submissions", field(output, "processedSubmissions")],
    ["processed facts", field(output, "processedFacts")],
    ["extractor runs", field(output, "extractorRuns")],
  ] as const;
  if (counts.every(([, value]) => value === undefined)) {
    return { kind: "empty", message: "No counts reported." };
  }
  return {
    kind: "stats",
    items: counts.map(([label, value]) => ({ label, value: count(value) })),
  };
}

export function registerSecPanels(): void {
  registerWebPanel({
    id: "sec.extractor.deadLetters",
    title: "Dead letters",
    source,
    appliesTo: (invocation) => pathIs(invocation, "extractor", "dead-letters"),
    load: async ({ output }) => deadLetterPanel(output),
  });

  registerWebPanel({
    id: "sec.version.status",
    title: "Version slots",
    source,
    appliesTo: (invocation) => pathIs(invocation, "version", "status"),
    load: async ({ output }) => versionStatusPanel(output),
  });

  registerWebPanel({
    id: "sec.query.rows",
    title: "Rows",
    source,
    appliesTo: (invocation) => pathStartsWith(invocation, "query") && invocation.path.length === 2,
    load: async ({ output }) => queryRowsPanel(output),
  });

  registerWebPanel({
    id: "sec.db.stats",
    title: "Stored rows",
    source,
    appliesTo: (invocation) =>
      pathIs(invocation, "db", "stats") || pathIs(invocation, "db", "status"),
    load: async ({ output }) => dbStatsPanel(output),
  });
}
