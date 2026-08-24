/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebPanel, type PanelData, type WebInvocation, type WebTone } from "@workglow/cli";
import {
  count,
  field,
  jsonList,
  money,
  recordArray,
  tableFromRecords,
  text,
} from "./secPanelFormat";

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

/** Lifecycle status, coloured by whether the vehicle is still live. */
function spacStatusTone(status: unknown): WebTone {
  if (status === "completed") return "ok";
  if (status === "liquidated" || status === "withdrawn") return "fail";
  if (status === "deal_announced" || status === "proxy" || status === "loi") return "info";
  return "idle";
}

const DEAL_OUTCOME_TONE: Readonly<Record<string, WebTone>> = {
  completed: "ok",
  terminated: "fail",
  pending: "warn",
};

/** A de-SPAC milestone reads as progress; a wind-up does not. */
const EVENT_TONE: Readonly<Record<string, WebTone>> = {
  ipo: "info",
  unit_split: "idle",
  loi: "info",
  definitive_agreement: "info",
  proxy: "info",
  vote: "info",
  completed: "ok",
  terminated: "fail",
  deregistration: "fail",
  liquidation: "fail",
};

function spacHeadline(output: unknown): PanelData {
  const spac = field(output, "spac");
  if (!spac) {
    return {
      kind: "empty",
      message: "No spac row for this CIK — its registration statement has not been processed yet.",
    };
  }
  const status = field(spac, "status");
  const trust = field(spac, "current_trust_amount") ?? field(spac, "trust_amount");
  return {
    kind: "stats",
    items: [
      { label: "status", value: text(status), tone: spacStatusTone(status) },
      { label: "SPAC name", value: text(field(spac, "spac_name")) },
      { label: "current name", value: text(field(spac, "current_name")) },
      { label: "target", value: text(field(spac, "target_name")) },
      { label: "IPO proceeds", value: money(field(spac, "ipo_proceeds")) },
      {
        label: "trust",
        value: money(trust),
        detail:
          field(spac, "current_trust_as_of") !== null &&
          field(spac, "current_trust_as_of") !== undefined
            ? `as of ${text(field(spac, "current_trust_as_of"))}`
            : "at IPO",
      },
      { label: "PIPE", value: money(field(spac, "pipe_amount")) },
      { label: "redemptions", value: money(field(spac, "total_redemption_amount")) },
      { label: "tickers", value: jsonList(field(spac, "current_tickers")) },
      { label: "sponsors", value: count(field(output, "sponsorCount")) },
      { label: "underwriters", value: count(field(output, "underwriterCount")) },
    ],
  };
}

/**
 * The event stream as what it is.
 *
 * A SPAC's whole story is dated events in order, and reading it out of a
 * two-column table means reconstructing the order in your head — which is
 * exactly the step that goes wrong when a deregistration sorts ahead of the
 * completion it follows.
 */
function spacTimeline(output: unknown): PanelData {
  const events = [...recordArray(field(output, "events"))].sort((a, b) =>
    String(a.event_date ?? "").localeCompare(String(b.event_date ?? ""))
  );
  if (events.length === 0) return { kind: "empty", message: "No recorded events." };
  return {
    kind: "timeline",
    events: events.map((event) => ({
      date: text(event.event_date),
      label: text(event.event_type),
      detail: [
        event.form ? String(event.form) : undefined,
        event.amount ? money(event.amount) : undefined,
        event.detail ? String(event.detail) : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      tone: EVENT_TONE[String(event.event_type)],
    })),
  };
}

function spacDeals(output: unknown): PanelData {
  const deals = recordArray(field(output, "deals"));
  if (deals.length === 0) return { kind: "empty", message: "No combination attempts recorded." };
  return {
    kind: "table",
    columns: ["#", "target", "outcome", "announced", "proxy", "vote", "PIPE", "equity", "redeemed"],
    rows: deals.map((deal) => [
      text(deal.deal_index),
      text(deal.target_name),
      text(deal.outcome),
      text(deal.announced_date),
      text(deal.proxy_date),
      text(deal.vote_date),
      money(deal.pipe_amount),
      money(deal.equity_value),
      money(deal.redemption_amount),
    ]),
    rowTones: deals.map((deal) => DEAL_OUTCOME_TONE[String(deal.outcome)]),
  };
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

const CONFIDENCE_TONE: Readonly<Record<string, WebTone>> = {
  high: "ok",
  medium: "warn",
  low: "idle",
};

function spacCandidatesPanel(output: unknown): PanelData {
  const rows = recordArray(field(output, "candidates")).concat(recordArray(field(output, "rows")));
  if (rows.length === 0) return { kind: "empty", message: "No candidates matched." };
  return {
    kind: "table",
    columns: ["cik", "name", "confidence", "SIC", "first registration", "signals"],
    rows: rows.map((row) => [
      text(row.cik),
      text(row.name),
      text(row.confidence),
      text(row.current_sic),
      [text(row.first_reg_form), text(row.first_reg_date)].filter((v) => v !== "—").join(" "),
      [
        row.signal_sic_6770 ? "sic" : undefined,
        row.signal_name_match ? "name" : undefined,
        row.signal_renamed_from ? "former-name" : undefined,
        row.signal_filed_sic_6770 ? "as-filed" : undefined,
      ]
        .filter(Boolean)
        .join(" "),
    ]),
    rowTones: rows.map((row) => CONFIDENCE_TONE[String(row.confidence)]),
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

/**
 * An eval sweep's ranking, which is the whole point of running one.
 *
 * The per-model summaries, not the per-fixture results: a sweep of four models
 * over eleven extractors produces hundreds of rows, and the question being
 * asked is which model to adopt.
 */
function evalPanel(output: unknown): PanelData {
  const summaries = recordArray(field(output, "summaries"));
  const rows = summaries.length > 0 ? summaries : recordArray(field(output, "results"));
  if (rows.length === 0) return { kind: "empty", message: "The sweep scored nothing." };
  const skipped = field(output, "skipped");
  return tableFromRecords(rows, {
    note: [
      Array.isArray(skipped) && skipped.length > 0
        ? `${skipped.length} sections skipped`
        : typeof skipped === "number" && skipped > 0
          ? `${count(skipped)} sections skipped`
          : undefined,
      summaries.length === 0
        ? "Per-fixture results — this sweep reported no summaries."
        : undefined,
      "Cost is estimated from character counts, not billed usage; the ranking is what matters.",
    ]
      .filter(Boolean)
      .join(" · "),
  });
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
    id: "sec.spac.headline",
    title: "SPAC",
    source,
    appliesTo: (invocation) => pathIs(invocation, "spac", "report"),
    load: async ({ output }) => spacHeadline(output),
  });
  registerWebPanel({
    id: "sec.spac.deals",
    title: "Combination attempts",
    source,
    appliesTo: (invocation) => pathIs(invocation, "spac", "report"),
    load: async ({ output }) => spacDeals(output),
  });
  registerWebPanel({
    id: "sec.spac.timeline",
    title: "Lifecycle",
    source,
    appliesTo: (invocation) => pathIs(invocation, "spac", "report"),
    load: async ({ output }) => spacTimeline(output),
  });
  registerWebPanel({
    id: "sec.spac.candidates",
    title: "Candidates",
    source,
    appliesTo: (invocation) => pathIs(invocation, "spac", "candidates"),
    load: async ({ output }) => spacCandidatesPanel(output),
  });

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
    id: "sec.eval.results",
    title: "Ranking",
    source,
    appliesTo: (invocation) => pathStartsWith(invocation, "eval") && invocation.path.length === 2,
    load: async ({ output }) => evalPanel(output),
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
