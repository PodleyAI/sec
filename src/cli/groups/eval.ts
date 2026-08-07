/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";
import { modelApiKeyEnvVar } from "../../config/registerModels";
import { EVAL_EXTRACTORS } from "../../eval/fixtures";
import { extractorsWithGoldenLabels } from "../../eval/goldenS1Labels";
import {
  extractorsWithFixtures,
  type EvalReport,
  type ModelSummary,
  type StabilitySummary,
} from "../../eval/runExtractionEval";
import type { ExtractionDiff } from "../../eval/scoreExtraction";
import { EvalExtractTask } from "../../task/eval/EvalExtractTask";
import { EvalS1Task, GOLDEN_REFERENCE, type OracleReport } from "../../task/eval/EvalS1Task";
import { EvalUnitTermsTask } from "../../task/eval/EvalUnitTermsTask";
import { type UnitTermsReport } from "../../eval/runUnitTermsEval";

/**
 * Default comparison set: a cheap and a strong model from each of the three
 * cloud providers we hold keys for. Cross-provider is the point — extraction
 * quality and reproducibility have both turned out to be provider-specific
 * (OpenAI's reasoning family rejects `temperature` outright; only Gemini offers
 * a sampling `seed`), so ranking within one vendor answers the wrong question.
 *
 * A local HFT model is deliberately NOT in the default sweep: it costs minutes
 * per section and is not a production candidate. Pass one explicitly
 * (`--models "$SEC_HFT_MODEL"`) to rank it — and note the local providers are
 * the only ones that can pin a seed, so they are where genuine reproducibility
 * is achievable.
 */
const DEFAULT_MODELS = [
  "claude-haiku-4-5",
  "claude-sonnet-5",
  "deepseek-v4-flash",
  "gemini-3.6-flash",
];

/**
 * The default set restricted to providers this shell actually holds a key for.
 *
 * The defaults span three providers, so a bare `sec eval extract` on a machine
 * with only `ANTHROPIC_API_KEY` set would spend the sweep producing failed runs
 * for half the table and report them beside the real results as if the models
 * had been ranked and lost. Dropping them (with a warning that names the ids and
 * the variables that would bring them back) keeps the documented default list
 * while making the bare command work wherever it is run.
 *
 * Explicit `--models` is never filtered: naming an id is a request to run it,
 * and a failed run is the honest answer to "why doesn't this work?".
 */
function availableDefaultModels(): string[] {
  const missing = new Map<string, string[]>();
  const available = DEFAULT_MODELS.filter((id) => {
    const envVar = modelApiKeyEnvVar(id);
    if (envVar === undefined || (process.env[envVar] ?? "").trim() !== "") return true;
    missing.set(envVar, [...(missing.get(envVar) ?? []), id]);
    return false;
  });
  if (missing.size > 0) {
    const detail = [...missing]
      .map(([envVar, ids]) => `${ids.join(", ")} (needs ${envVar})`)
      .join("; ");
    console.warn(`Skipping default model(s) with no API key configured: ${detail}`);
  }
  // Every provider unconfigured is a configuration problem, not a reason to run
  // an empty sweep and report a vacuous pass: hand back the full list so the
  // failures name themselves.
  return available.length > 0 ? available : [...DEFAULT_MODELS];
}

/**
 * Default candidate for `sec eval s1`: score the cheap cloud model against the
 * reference, the comparison that decides production extraction. Same reasoning
 * as {@link DEFAULT_MODELS} — a local model is opt-in.
 */
const ORACLE_DEFAULT_CANDIDATE = "claude-haiku-4-5";

/**
 * Default reference for `sec eval s1`: the committed human-verified labels.
 *
 * A model reference is only as good as its own reads — every candidate's score
 * is capped by the reference's mistakes, and two runs of it disagree with each
 * other anyway, so the yardstick moves between evaluations. Golden labels are
 * fixed, free, and instant. They are the right default wherever they exist.
 *
 * The cost is coverage: labels exist for `management` and
 * `beneficial-ownership` only, so a golden run scores those and reports every
 * other section as skipped rather than silently passing. Pass
 * `--reference <model-id>` to fall back to an oracle for the unlabelled
 * extractors — accepting that its verdict is an opinion, not truth.
 */
const ORACLE_DEFAULT_REFERENCE = GOLDEN_REFERENCE;

function parseModels(csv: string | undefined): string[] {
  const ids = (csv ?? availableDefaultModels().join(","))
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

/**
 * Join a capped list of row keys, appending "(+N more)" when truncated. Each key
 * is quoted: entity names routinely contain commas ("V-Cube, Inc."), so a bare
 * ", " join renders two rows as `V-Cube, Inc., Naoaki Mashita` — unreadable, and
 * indistinguishable from ONE name that merely contains a comma. That ambiguity
 * matters here: whether a model emitted one combined name or two separate owners
 * is exactly what these diffs exist to show. Same reasoning as `displayValue` in
 * scoreExtraction.ts, which bracket-quotes arrays for this reason.
 */
function keyList(keys: readonly string[], cap = 8): string {
  const shown = keys.slice(0, cap).map((k) => `"${truncate(k, 40)}"`);
  const extra = keys.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} (+${extra} more)` : shown.join(", ");
}

/** @internal test seam for {@link keyList}. */
export const keyListForTesting = keyList;

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

const DEFAULT_SCORE_LEGEND =
  "score = field-level F1 (names + titles): rewards found values and penalizes missed " +
  "AND invented ones; found = expected people matched; prec = 1 − hallucinated rows.\n" +
  "est.cost is an estimate (no usage from the task); local models are $0. " +
  "Best-first: correctness, then cost, then latency.";

/**
 * Reproducibility table, shown only when the sweep repeated fixtures.
 *
 * `same` is how many fixtures produced byte-identical output on every run;
 * `same facts` relaxes that to ignore `source_span`/`confidence`. The gap
 * between the two columns is the interesting part: on real filings the model
 * has repeatedly found the SAME risks while cutting their captions at different
 * points, which is a prompt problem, not a "the model is unreliable" problem.
 * One number could not tell those apart.
 */
function printStability(report: EvalReport): void {
  const stability = report.stability;
  if (!stability || stability.length === 0) return;
  const runs = stability[0].runs;
  console.log(`\nreproducibility over ${runs} runs per fixture:`);
  const cols: Array<[string, number, (s: StabilitySummary) => string]> = [
    ["model", 34, (m) => m.model],
    ["same", 12, (m) => `${m.stableExact}/${m.fixtures}`],
    ["same facts", 12, (m) => `${m.stableContent}/${m.fixtures}`],
  ];
  console.log(cols.map(([h, w]) => pad(h, w)).join(" "));
  console.log(cols.map(([, w]) => "-".repeat(w)).join(" "));
  for (const m of [...stability].sort((a, b) => b.stableContent - a.stableContent)) {
    console.log(cols.map(([, w, get]) => pad(get(m), w)).join(" "));
  }
  console.log(
    "\n  same = byte-identical rows incl. citations; same facts = ignoring source_span/confidence"
  );
}

function printTable(
  report: EvalReport,
  details: boolean,
  scoreLegend: string = DEFAULT_SCORE_LEGEND,
  unscored = false
): void {
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
    unscored
      ? "\nscore/found/prec are NOT meaningful here: the real sections carry no golden labels " +
          "(that is what `sec eval s1` uses a reference model for). Read the reproducibility " +
          "table, latency and cost."
      : `\n${scoreLegend}`
  );

  printStability(report);

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
    .option("--models <csv>", `comma-separated model ids (default: ${DEFAULT_MODELS.join(", ")})`)
    .option(
      "--extractor <name>",
      // Only offer what is actually scorable: an extractor registered in
      // EVAL_EXTRACTORS with no committed fixture has nothing to run.
      `limit to one extractor (${extractorsWithFixtures().join(", ")})`
    )
    .option("--format <fmt>", "table | json", "table")
    .option("--no-details", "hide per-row/field disagreements after the table")
    .option(
      "--runs <n>",
      "repeat each fixture N times per model and report reproducibility (default 1)",
      (v) => Number(v)
    )
    .option(
      "--real",
      "sweep the REAL committed S-1 sections (12k-275k chars) instead of the curated miniatures; correctness is not scored (no golden labels at that size), reproducibility/latency/cost are"
    )
    .action(
      async (opts: {
        models?: string;
        extractor?: string;
        format: string;
        details: boolean;
        runs?: number;
        real?: boolean;
      }) => {
        await runCommand(async () => {
          const models = parseModels(opts.models);
          if (opts.runs !== undefined && (!Number.isFinite(opts.runs) || opts.runs < 1)) {
            throw new Error(`--runs must be a positive integer; got "${opts.runs}"`);
          }
          if (opts.extractor && !EVAL_EXTRACTORS[opts.extractor]) {
            throw new Error(
              `unknown extractor "${opts.extractor}"; known: ${Object.keys(EVAL_EXTRACTORS).join(", ")}`
            );
          }
          const input = {
            models,
            ...(opts.extractor ? { extractor: opts.extractor } : {}),
            ...(opts.runs !== undefined ? { runs: Math.trunc(opts.runs) } : {}),
            ...(opts.real ? { real: true } : {}),
          };
          // runWorkflowCli renders the task-graph progress UI on a TTY (clearing
          // it before we print), and runs plainly when piped.
          const report = await runWorkflowCli<EvalReport>([
            new EvalExtractTask({ defaults: input }),
          ]);
          if (opts.format === "json") {
            console.log(JSON.stringify(report, null, 2));
            return;
          }
          printTable(report, opts.details, DEFAULT_SCORE_LEGEND, opts.real === true);
        });
      }
    );

  cmd
    .command("s1")
    .description("Compare candidate models against a reference on REAL committed S-1 sections")
    .option(
      "--reference <id>",
      "reference (oracle) model id, or 'golden' for committed human-verified labels",
      ORACLE_DEFAULT_REFERENCE
    )
    .option(
      "--models <csv>",
      `model ids to score against the reference (default: ${ORACLE_DEFAULT_CANDIDATE})`
    )
    .option(
      "--extractors <csv>",
      `sections to pull (${Object.keys(EVAL_EXTRACTORS).join(", ")}); default: every extractor with golden labels (${extractorsWithGoldenLabels().join(", ")}), or management against a model reference`
    )
    .option(
      "--dir <path>",
      "directory of real S-1 HTML to segment (default: committed mock_data; " +
        "point at mock_data/s1/.cache after `sec fetch s1-fixtures`)"
    )
    .option(
      "--cik <csv>",
      "limit the sweep to these filer CIKs (leading zeros optional) — isolates one " +
        "filing when checking a newly added fixture or label"
    )
    .option("--format <fmt>", "table | json", "table")
    .option("--no-details", "hide per-row/field disagreements after the table")
    .action(
      async (opts: {
        reference: string;
        models?: string;
        extractors?: string;
        dir?: string;
        cik?: string;
        format: string;
        details: boolean;
      }) => {
        await runCommand(async () => {
          const candidates = opts.models
            ? opts.models
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [ORACLE_DEFAULT_CANDIDATE];
          // Under golden truth, default to every extractor that HAS labels —
          // scoring only `management` while committed beneficial-ownership
          // labels sat unused made the default look narrower than the evidence
          // actually available. Against a model oracle there is no such
          // coverage signal, so that path keeps its single cheap default.
          const defaultExtractors =
            opts.reference === GOLDEN_REFERENCE ? extractorsWithGoldenLabels() : ["management"];
          const extractors = opts.extractors
            ? opts.extractors
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : defaultExtractors;
          for (const name of extractors) {
            if (!EVAL_EXTRACTORS[name]) {
              throw new Error(
                `unknown extractor "${name}"; known: ${Object.keys(EVAL_EXTRACTORS).join(", ")}`
              );
            }
          }
          const ciks = opts.cik
            ? opts.cik
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined;
          const input = {
            reference: opts.reference,
            candidates,
            extractors,
            ...(opts.dir ? { dir: opts.dir } : {}),
            ...(ciks && ciks.length > 0 ? { ciks } : {}),
          };
          // runWorkflowCli renders the task-graph progress UI on a TTY (clearing
          // it before we print), and runs plainly when piped.
          const report = await runWorkflowCli<OracleReport>([new EvalS1Task({ defaults: input })]);
          if (opts.format === "json") {
            console.log(JSON.stringify(report, null, 2));
            return;
          }
          printOracleTable(report, opts.details);
        });
      }
    );

  cmd
    .command("unit-terms")
    .description(
      "Score offering-terms extraction against embarc's hand-curated SPAC unit structure"
    )
    .option("--models <csv>", `comma-separated model ids (default: ${DEFAULT_MODELS.join(", ")})`)
    .option(
      "--dir <path>",
      "directory of real S-1 HTML to segment (default: committed mock_data; " +
        "point at mock_data/s1/.cache after `sec fetch s1-fixtures`)"
    )
    .option("--format <fmt>", "table | json", "table")
    .option("--no-details", "hide per-row/field disagreements after the table")
    .action(async (opts: { models?: string; dir?: string; format: string; details: boolean }) => {
      await runCommand(async () => {
        const models = parseModels(opts.models);
        const input = { models, ...(opts.dir ? { dir: opts.dir } : {}) };
        const report = await runWorkflowCli<UnitTermsReport>([
          new EvalUnitTermsTask({ defaults: input }),
        ]);
        if (opts.format === "json") {
          console.log(JSON.stringify(report, null, 2));
          return;
        }
        console.log(
          `Truth: embarc curated unit terms — over ${report.sections} real S-1 offering ` +
            `section(s)${report.skipped.length ? ` (${report.skipped.length} filing(s) skipped)` : ""}\n`
        );
        printTable(
          report,
          opts.details,
          "score = field-value F1 vs embarc's curated unit terms (price / warrant fraction / " +
            "rights fraction, rounded to 2 decimals); found = covered filings with a matching " +
            "row; prec = 1 − spurious rows.\n" +
            "est.cost is an estimate; local models are $0. Best-first: correctness, then cost, " +
            "then latency."
        );
        if (report.skipped.length) {
          console.log("\nskipped:");
          for (const sMsg of report.skipped) console.log(`  ${sMsg}`);
        }
      });
    });
}
