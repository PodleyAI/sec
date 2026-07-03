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

/**
 * Default comparison set: a cheap cloud model, a mid cloud model, and the local
 * HFT model (free but slower/less accurate) — a genuine 3-way out of the box.
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
}
