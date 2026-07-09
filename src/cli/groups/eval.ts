/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { SecHftModelDefault } from "../../config/Constants";
import { runCommand } from "../runCommand";
import { EVAL_EXTRACTORS } from "../../eval/fixtures";
import {
  runExtractionEval,
  type EvalReport,
  type ModelSummary,
} from "../../eval/runExtractionEval";
import { runOracleEval, type OracleReport } from "../../eval/runOracleEval";

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

function printTable(report: EvalReport): void {
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
    "\nscore = field-level correctness (names + titles); found = expected people matched; " +
      "prec = 1 − hallucinated rows.\nest.cost is an estimate (no usage from the task); " +
      "local models are $0. Best-first: correctness, then cost, then latency."
  );

  const failed = report.results.filter((r) => !r.ok);
  if (failed.length) {
    console.log("\nfailures:");
    for (const r of failed) console.log(`  ${r.model} / ${r.fixture}: ${r.error}`);
  }
}

function printOracleTable(report: OracleReport): void {
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
    "\nagree = field agreement with the reference (names + titles); recall = reference " +
      "entities the model also found;\nprec = model entities the reference also had " +
      "(1 − hallucination), over DISTINCT rows; rows = raw rows emitted, dist = distinct " +
      "after de-duping on the key field (gap = duplicate over-production).\nReference rows " +
      "are the truth, so it has no agreement score."
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
    .action(async (opts: { models?: string; extractor?: string; format: string }) => {
      await runCommand(async () => {
        const models = parseModels(opts.models);
        if (opts.extractor && !EVAL_EXTRACTORS[opts.extractor]) {
          throw new Error(
            `unknown extractor "${opts.extractor}"; known: ${Object.keys(EVAL_EXTRACTORS).join(", ")}`
          );
        }
        const report = await runExtractionEval({ models, extractor: opts.extractor });
        if (opts.format === "json") {
          console.log(JSON.stringify(report, null, 2));
          return;
        }
        printTable(report);
      });
    });

  cmd
    .command("s1")
    .description(
      "Compare candidate models against a reference on REAL committed S-1 sections"
    )
    .option("--reference <id>", "reference (oracle) model id", "claude-sonnet-5")
    .option(
      "--candidates <csv>",
      `candidate model ids (default: ${SecHftModelDefault})`
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
    .action(
      async (opts: {
        reference: string;
        candidates?: string;
        extractors?: string;
        dir?: string;
        format: string;
      }) => {
        await runCommand(async () => {
          const candidates = opts.candidates
            ? opts.candidates.split(",").map((s) => s.trim()).filter(Boolean)
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
          const report = await runOracleEval({
            reference: opts.reference,
            candidates,
            extractors,
            dir: opts.dir,
            // Progress to stderr so `--format json` on stdout stays parseable.
            onProgress: (m) => console.error(m),
          });
          if (opts.format === "json") {
            console.log(JSON.stringify(report, null, 2));
            return;
          }
          printOracleTable(report);
        });
      }
    );
}
