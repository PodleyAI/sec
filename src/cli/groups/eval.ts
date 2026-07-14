/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { withCli } from "@workglow/cli";
import { SecHftModelDefault } from "../../config/Constants";
import { runCommand } from "../runCommand";
import { EVAL_EXTRACTORS } from "../../eval/fixtures";
import { type EvalReport, type ModelSummary } from "../../eval/runExtractionEval";
import { type OracleReport } from "../../eval/runOracleEval";
import type { ExtractionDiff } from "../../eval/scoreExtraction";
import { EvalExtractTask } from "../../task/eval/EvalExtractTask";
import { EvalS1Task } from "../../task/eval/EvalS1Task";

/**
 * Default comparison set: a cheap cloud model, a mid cloud model, and the local
 * HFT default ({@link SecHftModelDefault}, LFM2.5-350M) — a genuine 3-way. The
 * local model runs in seconds per call (after a one-time ~300 MB download), so
 * it is fast enough to include by default.
 */
const DEFAULT_MODELS = ["claude-haiku-4-5", "claude-sonnet-5", SecHftModelDefault];

function parseModels(csv: string | undefined): string[] {
  const ids = (csv ?? DEFAULT_MODELS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function usd(x: number | null): string {
  return x === null ? "  ?  " : `$${x.toFixed(5)}`;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

/** Collapse whitespace and cap length so long bios / source spans stay one-line. */
function truncate(s: string, max = 60): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function hasDiff(d: ExtractionDiff): boolean {
  return d.missing.length > 0 || d.extra.length > 0 || d.mismatches.length > 0;
}

/** Join a capped list of row keys, appending "(+N more)" when truncated. */
function keyList(keys: readonly string[], cap = 8): string {
  const shown = keys.slice(0, cap).map((k) => truncate(k, 40));
  const extra = keys.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} (+${extra} more)` : shown.join(", ");
}

interface DiffEntry {
  readonly model: string;
  readonly section: string;
  readonly extractor: string;
  readonly diff: ExtractionDiff;
}

/**
 * Print the concrete disagreements behind the aggregate scores, grouped by model:
 * expected/reference rows the candidate missed, rows it invented, and per-field
 * value mismatches on the rows that aligned. This is the "why is the score not
 * 100%" view the table alone can't give.
 */
function printDiffs(entries: readonly DiffEntry[], truthLabel: string): void {
  const withDiff = entries.filter((e) => hasDiff(e.diff));
  if (!withDiff.length) {
    console.log(`\nno row/field disagreements — every scored run matched the ${truthLabel}.`);
    return;
  }
  console.log(`\ndisagreements (${truthLabel} vs got):`);
  const byModel = new Map<string, DiffEntry[]>();
  for (const e of withDiff) {
    (byModel.get(e.model) ?? byModel.set(e.model, []).get(e.model)!).push(e);
  }
  for (const [model, es] of byModel) {
    console.log(`\n  ${model}`);
    for (const e of es) {
      console.log(`    ${e.section} / ${e.extractor}`);
      if (e.diff.missing.length) {
        console.log(`      missing (${e.diff.missing.length}): ${keyList(e.diff.missing)}`);
      }
      if (e.diff.extra.length) {
        console.log(`      extra   (${e.diff.extra.length}): ${keyList(e.diff.extra)}`);
      }
      const mm = e.diff.mismatches;
      for (const m of mm.slice(0, 12)) {
        console.log(
          `      ${truncate(m.key, 30)} · ${m.field}: "${truncate(m.expected)}" → "${truncate(m.got)}"`
        );
      }
      if (mm.length > 12) console.log(`      … +${mm.length - 12} more field mismatch(es)`);
    }
  }
}

function printTable(report: EvalReport, details: boolean): void {
  const cols: Array<[string, number, (m: ModelSummary) => string]> = [
    ["#", 2, () => ""],
    ["model", 34, (m) => m.model],
    ["provider", 20, (m) => m.provider],
    ["score", 7, (m) => pct(m.avgScore)],
    ["found", 7, (m) => pct(m.avgEntityRecall)],
    ["prec", 6, (m) => pct(m.avgPrecision)],
    ["latency", 10, (m) => `${m.avgLatencyMs.toFixed(0)}ms`],
    ["est.cost", 10, (m) => usd(m.totalUsd)],
    ["ok", 6, (m) => `${m.okRuns}/${m.runs}`],
  ];
  console.log(cols.map(([h, w]) => pad(h, w)).join(" "));
  console.log(cols.map(([, w]) => "-".repeat(w)).join(" "));
  report.summaries.forEach((m, i) => {
    const rank = pad(String(i + 1), 2);
    const rest = cols
      .slice(1)
      .map(([, w, get]) => pad(get(m), w))
      .join(" ");
    console.log(`${rank} ${rest}`);
  });
  console.log(
    "\nscore = field-level F1 (names + titles): rewards found values and penalizes missed " +
      "AND invented ones; found = expected people matched; prec = 1 − hallucinated rows.\n" +
      "est.cost is an estimate (no usage from the task); local models are $0. " +
      "Best-first: correctness, then cost, then latency."
  );

  const failed = report.results.filter((r) => !r.ok);
  if (failed.length) {
    console.log("\nfailures:");
    for (const r of failed) console.log(`  ${r.model} / ${r.fixture}: ${r.error}`);
  }

  if (details) {
    printDiffs(
      report.results
        .filter((r) => r.ok)
        .map((r) => ({
          model: r.model,
          section: r.fixture,
          extractor: r.extractor,
          diff: r.score.diff,
        })),
      "expected"
    );
  }
}

function printOracleTable(report: OracleReport, details: boolean): void {
  console.log(
    `Reference (truth): ${report.reference} — over ${report.sections} real S-1 section(s)\n`
  );
  const cols: Array<[string, number, (m: OracleReport["summaries"][number]) => string]> = [
    ["role", 10, (m) => m.role],
    ["model", 34, (m) => m.model],
    ["agree", 7, (m) => (m.role === "reference" ? "—" : pct(m.avgAgreement))],
    ["recall", 7, (m) => (m.role === "reference" ? "—" : pct(m.avgEntityRecall))],
    ["prec", 6, (m) => (m.role === "reference" ? "—" : pct(m.avgPrecision))],
    ["rows", 6, (m) => String(m.totalRows)],
    ["dist", 6, (m) => String(m.totalDistinctRows)],
    ["latency", 10, (m) => `${m.avgLatencyMs.toFixed(0)}ms`],
    ["est.cost", 10, (m) => usd(m.totalUsd)],
    ["ok", 6, (m) => `${m.okRuns}/${m.runs}`],
  ];
  console.log(cols.map(([h, w]) => pad(h, w)).join(" "));
  console.log(cols.map(([, w]) => "-".repeat(w)).join(" "));
  for (const m of report.summaries) {
    console.log(cols.map(([, w, get]) => pad(get(m), w)).join(" "));
  }
  console.log(
    "\nagree = field-value F1 vs the reference (names + titles): penalizes both missed and " +
      "invented values; recall = reference entities the model also found;\nprec = model " +
      "entities the reference also had (1 − hallucination), over DISTINCT rows; rows = raw " +
      "rows emitted, dist = distinct after de-duping on the key field (gap = duplicate " +
      "over-production).\nReference rows are the truth, so it has no agreement score."
  );
  const failed = report.results.filter((r) => !r.ok);
  if (failed.length) {
    console.log("\nfailures:");
    for (const r of failed) console.log(`  ${r.model} / ${r.filing} / ${r.extractor}: ${r.error}`);
  }
  if (report.skipped.length) {
    console.log("\nskipped (no such section / unparseable):");
    for (const s of report.skipped) console.log(`  ${s}`);
  }

  if (details) {
    // Reference runs carry no score (they ARE the truth); only scored candidate
    // runs have a diff to show against the reference.
    printDiffs(
      report.results
        .filter((r) => r.score !== null)
        .map((r) => ({
          model: r.model,
          section: r.filing,
          extractor: r.extractor,
          diff: r.score!.diff,
        })),
      "reference"
    );
  }
}

export function addEvalCommands(program: Command): void {
  const cmd = program
    .command("eval")
    .description("Compare extraction models on cost, speed, and correctness");

  cmd
    .command("extract")
    .description("Run golden extraction fixtures across models and rank them")
    .option(
      "--models <csv>",
      `comma-separated model ids (default: ${DEFAULT_MODELS.join(", ")})`
    )
    .option(
      "--extractor <name>",
      `limit to one extractor (${Object.keys(EVAL_EXTRACTORS).join(", ")})`
    )
    .option("--format <fmt>", "table | json", "table")
    .option("--no-details", "hide per-row/field disagreements after the table")
    .action(
      async (opts: {
        models?: string;
        extractor?: string;
        format: string;
        details: boolean;
      }) => {
        await runCommand(async () => {
          const models = parseModels(opts.models);
          if (opts.extractor && !EVAL_EXTRACTORS[opts.extractor]) {
            throw new Error(
              `unknown extractor "${opts.extractor}"; known: ${Object.keys(EVAL_EXTRACTORS).join(", ")}`
            );
          }
          const input = opts.extractor ? { models, extractor: opts.extractor } : { models };
          // withCli renders the task-graph progress UI on a TTY (clearing it
          // before we print), and runs plainly when piped.
          const report = (await withCli(new EvalExtractTask()).run(input)) as EvalReport;
          if (opts.format === "json") {
            console.log(JSON.stringify(report, null, 2));
            return;
          }
          printTable(report, opts.details);
        });
      }
    );

  cmd
    .command("s1")
    .description(
      "Compare candidate models against a reference on REAL committed S-1 sections"
    )
    .option("--reference <id>", "reference (oracle) model id", "claude-sonnet-5")
    .option(
      "--models <csv>",
      `model ids to score against the reference (default: ${SecHftModelDefault})`
    )
    .option(
      "--extractors <csv>",
      `sections to pull (${Object.keys(EVAL_EXTRACTORS).join(", ")}); default: management`
    )
    .option(
      "--dir <path>",
      "directory of real S-1 HTML to segment (default: committed mock_data; " +
        "point at mock_data/s1/.cache after `sec fetch s1-fixtures`)"
    )
    .option("--format <fmt>", "table | json", "table")
    .option("--no-details", "hide per-row/field disagreements after the table")
    .action(
      async (opts: {
        reference: string;
        models?: string;
        extractors?: string;
        dir?: string;
        format: string;
        details: boolean;
      }) => {
        await runCommand(async () => {
          const candidates = opts.models
            ? opts.models.split(",").map((s) => s.trim()).filter(Boolean)
            : [SecHftModelDefault];
          const extractors = opts.extractors
            ? opts.extractors.split(",").map((s) => s.trim()).filter(Boolean)
            : ["management"];
          for (const name of extractors) {
            if (!EVAL_EXTRACTORS[name]) {
              throw new Error(
                `unknown extractor "${name}"; known: ${Object.keys(EVAL_EXTRACTORS).join(", ")}`
              );
            }
          }
          const input = {
            reference: opts.reference,
            candidates,
            extractors,
            ...(opts.dir ? { dir: opts.dir } : {}),
          };
          // withCli renders the task-graph progress UI on a TTY (clearing it
          // before we print), and runs plainly when piped.
          const report = (await withCli(new EvalS1Task()).run(input)) as OracleReport;
          if (opts.format === "json") {
            console.log(JSON.stringify(report, null, 2));
            return;
          }
          printOracleTable(report, opts.details);
        });
      }
    );
}
