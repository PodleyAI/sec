/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";
import { csvOptionValue, optionValue } from "../optionValue";
import { parseIntOption } from "../GlobalOptions";
import { KNOWN_MODEL_ID_SHAPES, modelApiKeyEnvVar } from "../../config/registerModels";
import { availableFixtureCiks, loadRealS1Sections } from "../../eval/realSections";
import { EVAL_EXTRACTORS, preparedSectionText } from "../../eval/fixtures";
import { defaultGoldenSweepExtractors } from "../../eval/defaultSweepExtractors";
import {
  printEvalPrompts,
  printPromptsNeedsSectionText,
  type PrintPromptItem,
  type PrintPromptsMode,
} from "../../eval/printEvalPrompts";
import type { EvalRawDump } from "../../eval/captureEvalRaw";
import { shouldDumpEvalRaw, writeEvalRawDump } from "../../eval/dumpEvalRaw";
import {
  availableFixtures,
  extractorsWithFixtures,
  resolveEvalFixtures,
  type EvalReport,
  type ModelSummary,
  type StabilitySummary,
} from "../../eval/runExtractionEval";
import type { ExtractionDiff } from "../../eval/scoreExtraction";
import { EvalExtractTask } from "../../task/eval/EvalExtractTask";
import { EvalS1Task, GOLDEN_REFERENCE, type OracleReport } from "../../task/eval/EvalS1Task";
import {
  evalS1ConcurrencyProduct,
  formatEvalS1Concurrency,
  resolveEvalS1Concurrency,
  EVAL_S1_CONCURRENCY_DEFAULTS,
} from "../../task/eval/evalS1Concurrency";
import { EvalUnitTermsTask } from "../../task/eval/EvalUnitTermsTask";
import { EvalOfferingTablesTask } from "../../task/eval/EvalOfferingTablesTask";
import { EvalUnderwritersTask } from "../../task/eval/EvalUnderwritersTask";
import { EvalUseOfProceedsTask } from "../../task/eval/EvalUseOfProceedsTask";
import { EvalExecutiveCompensationTask } from "../../task/eval/EvalExecutiveCompensationTask";
import { EvalBeneficialOwnershipTask } from "../../task/eval/EvalBeneficialOwnershipTask";
import { EvalManagementTask } from "../../task/eval/EvalManagementTask";
import { EvalRelatedPartyTask } from "../../task/eval/EvalRelatedPartyTask";
import { EvalSpacSponsorsTask } from "../../task/eval/EvalSpacSponsorsTask";
import { EvalSpacProfileTask } from "../../task/eval/EvalSpacProfileTask";
import { EvalSpacClassificationTask } from "../../task/eval/EvalSpacClassificationTask";
import { type UnitTermsReport } from "../../eval/runUnitTermsEval";
import type { OfferingTablesReport } from "../../eval/runOfferingTablesEval";
import type { UnderwritersReport } from "../../eval/runUnderwritersEval";
import type { UseOfProceedsReport } from "../../eval/runUseOfProceedsEval";
import type { ExecutiveCompensationReport } from "../../eval/runExecutiveCompensationEval";
import type { BeneficialOwnershipReport } from "../../eval/runBeneficialOwnershipEval";
import type { ManagementReport } from "../../eval/runManagementEval";
import type { RelatedPartyReport } from "../../eval/runRelatedPartyEval";
import type { SpacSponsorsReport } from "../../eval/runSpacSponsorsEval";
import type { SpacProfileReport } from "../../eval/runSpacProfileEval";
import type { SpacClassificationReport } from "../../eval/runSpacClassificationEval";

/**
 * Default comparison set: Anthropic's cheap and strong tiers, plus the cheap
 * tier of two other cloud providers we hold keys for. Cross-provider is the
 * point — extraction quality and reproducibility have both turned out to be
 * provider-specific (OpenAI's reasoning family rejects `temperature` outright;
 * only Gemini offers a sampling `seed`), so ranking within one vendor answers
 * the wrong question. The sweep needs `DEEPSEEK_API_KEY` and `GEMINI_API_KEY`
 * as well as `ANTHROPIC_API_KEY`; a missing key is recorded as a failed run per
 * fixture rather than aborting the sweep.
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

function parseModels(ids: readonly string[] | undefined): string[] {
  return [...new Set(ids ?? availableDefaultModels())];
}

/**
 * `--models` as given, or `undefined` when the flag was omitted. Print-prompts
 * must not default the list: a bare `--print-prompts` still dumps AI prompts,
 * and only an explicit `deterministic` skips that dump.
 */
function printPromptModelIds(
  modelsOpt: string | boolean | undefined,
  defaults: readonly string[]
): readonly string[] | undefined {
  return csvOptionValue("--models", modelsOpt, () => modelIdsHint(defaults));
}

/**
 * What `--models` / `--reference` accept. Model ids are not a closed set — any
 * id whose shape a provider claims works — so the hint names the defaults and
 * the shapes rather than pretending to enumerate.
 */
function modelIdsHint(defaults: readonly string[]): string {
  return (
    `comma-separated model ids (default: ${defaults.join(", ")}); ` +
    `any id routes by shape: ${KNOWN_MODEL_ID_SHAPES}`
  );
}

/** `--format` is a closed two-value set on every eval subcommand. */
function requireFormat(value: string | boolean): string {
  return optionValue("--format", value, () => "one of: table, json") ?? "table";
}

const PRINT_PROMPTS_MODES: readonly PrintPromptsMode[] = [
  "instructions",
  "template",
  "document",
  "schema",
  "full",
];

function requirePrintPromptsMode(
  value: string | boolean | undefined
): PrintPromptsMode | undefined {
  const raw = optionValue(
    "--print-prompts",
    value,
    () => `one of: ${PRINT_PROMPTS_MODES.join(", ")}`
  );
  if (raw === undefined) return undefined;
  if (!(PRINT_PROMPTS_MODES as readonly string[]).includes(raw)) {
    throw new Error(`--print-prompts needs a value — one of: ${PRINT_PROMPTS_MODES.join(", ")}`);
  }
  return raw as PrintPromptsMode;
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

/**
 * One scored case from a deterministic-parser eval. Every `run*Eval` report
 * shares this shape; `kind` is present only where one command scores two
 * destinations (offering terms vs sponsor promote).
 */
interface ParserEvalCase {
  readonly bucket: string;
  readonly accession_number: string;
  readonly cik: number | null;
  readonly cachePath: string | undefined;
  readonly kind?: string;
  readonly parsed?: unknown;
  readonly stored?: unknown;
}

interface ParserEvalReport {
  readonly cases: readonly ParserEvalCase[];
  readonly counts: Record<string, number>;
}

/**
 * The parser-vs-stored-rows table every `sec eval <parser>` command prints.
 * One implementation: the ten commands differed only in the label, so ten
 * copies of it could only drift.
 */
function printParserEvalReport(label: string, report: ParserEvalReport): void {
  const { counts } = report;
  console.log(
    `${label} parser vs stored rows  ` +
      `hit-agree=${counts["hit-agree"]}  hit-disagree=${counts["hit-disagree"]}  ` +
      `miss=${counts.miss}  empty=${counts.empty}  skip=${counts.skip}`
  );
  const flagged = report.cases.filter((c) => c.bucket === "miss" || c.bucket === "hit-disagree");
  if (flagged.length === 0) return;
  console.log("\nmiss / hit-disagree:");
  for (const c of flagged) {
    const cik = c.cik === null ? "" : ` cik=${c.cik}`;
    const kind = c.kind === undefined ? "" : ` ${c.kind}`;
    console.log(`  ${c.bucket}${kind} ${c.accession_number}${cik}  ${c.cachePath ?? ""}`);
    if (c.bucket === "hit-disagree") {
      console.log(`    parsed  ${JSON.stringify(c.parsed)}`);
      console.log(`    stored  ${JSON.stringify(c.stored)}`);
    }
  }
}

function hasDiff(d: ExtractionDiff): boolean {
  return d.missing.length > 0 || d.extra.length > 0 || d.mismatches.length > 0;
}

/**
 * Stderr dumps for `--dump-raw`: successful runs that disagree with truth.
 * Independent of `--details` / `--no-details` — the flag asked for the payload.
 */
function dumpDisagreementRaws(
  results: readonly {
    readonly ok: boolean;
    readonly model: string;
    readonly fixture?: string;
    readonly filing?: string;
    readonly extractor: string;
    readonly run?: number;
    readonly raw: EvalRawDump | undefined;
    readonly score: { readonly diff: ExtractionDiff } | null;
  }[]
): void {
  for (const r of results) {
    if (!r.ok || r.score == null) continue;
    if (!shouldDumpEvalRaw({ ok: true, raw: r.raw, diff: r.score.diff })) continue;
    const section = r.fixture ?? `${r.filing} / ${r.extractor}`;
    const runTag = r.run && r.run > 1 ? ` run=${r.run}` : "";
    writeEvalRawDump(`${r.model} / ${section}${runTag}`, r.raw!);
  }
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
  "est.cost uses provider-stated spend when the API returned it (OpenRouter), " +
  "else a char×rate-card estimate; local models are $0. " +
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
  // Denominator is `measured`, not `fixtures`: a fixture that did not complete
  // every repetition was never tested for reproducibility, and counting it
  // against the stable total reads as a fixture that WAS tested and varied. The
  // difference is named as skipped so the gap stays visible instead of being
  // silently absorbed.
  const skipped = (m: StabilitySummary): string =>
    m.fixtures > m.measured ? ` (${m.fixtures - m.measured} skipped)` : "";
  const cols: Array<[string, number, (s: StabilitySummary) => string]> = [
    ["model", 34, (m) => m.model],
    ["same", 12, (m) => `${m.stableExact}/${m.measured}${skipped(m)}`],
    ["same facts", 12, (m) => `${m.stableContent}/${m.measured}`],
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
    for (const r of failed) {
      const runTag = r.run > 1 ? ` run=${r.run}` : "";
      console.log(`  ${r.model} / ${r.fixture}${runTag}: ${r.error}`);
      if (shouldDumpEvalRaw({ ok: false, raw: r.raw, diff: undefined }) && r.raw) {
        writeEvalRawDump(`${r.model} / ${r.fixture}${runTag}`, r.raw);
      }
    }
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
  dumpDisagreementRaws(report.results);
}

/**
 * Names the requested axes when the sweep could not reach them, so an operator
 * who passed `--concurrency-section-model 4` and sees `x1` learns why (they
 * named one model) rather than suspecting the flag was ignored.
 */
function concurrencyRequestNote(report: OracleReport): string {
  const { concurrency: asked, effectiveConcurrency: got } = report;
  if (
    asked.s1 === got.s1 &&
    asked.section === got.section &&
    asked.sectionModel === got.sectionModel
  )
    return "";
  return (
    ` — requested ${formatEvalS1Concurrency(asked)}, capped by the filings, the widest ` +
    `filing's section count and the number of --models named`
  );
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
    // Latency is measured under whatever parallelism the sweep ran at, so the
    // header carries all three axes: an unlabelled `latency` invited comparison
    // of a serial figure against a 20-wide one as though they measured the same
    // thing, and wall-clock here includes time queued behind the sweep itself.
    // The EFFECTIVE axes, not the requested ones — every axis is capped by the
    // work available to it, so a default sweep with one `--models` id ran at
    // 1x5x1 while the request read 1x5x4.
    [
      `lat@${formatEvalS1Concurrency(report.effectiveConcurrency)}`,
      12,
      (m) => `${m.avgLatencyMs.toFixed(0)}ms`,
    ],
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
      "over-production).\nReference rows are the truth, so it has no agreement score.\n" +
      `lat@${formatEvalS1Concurrency(report.effectiveConcurrency)} = mean wall-clock per ` +
      `extraction measured with ${report.effectiveConcurrency.s1} filing(s) x at most ` +
      `${report.effectiveConcurrency.section} section(s) x ` +
      `${report.effectiveConcurrency.sectionModel} model(s) in flight ` +
      `(up to ${evalS1ConcurrencyProduct(report.effectiveConcurrency)} concurrent ` +
      `extractions)${concurrencyRequestNote(report)}.\n` +
      "Wall-clock includes time queued behind the sweep's own other extractions — a local " +
      "model's especially, since one worker serves them all — so set\n" +
      "--concurrency-s1 1 --concurrency-section 1 --concurrency-section-model 1 for figures " +
      "comparable across runs."
  );
  const failed = report.results.filter((r) => !r.ok);
  if (failed.length) {
    console.log("\nfailures:");
    for (const r of failed) {
      console.log(`  ${r.model} / ${r.filing} / ${r.extractor}: ${r.error}`);
      if (shouldDumpEvalRaw({ ok: false, raw: r.raw, diff: undefined }) && r.raw) {
        writeEvalRawDump(`${r.model} / ${r.filing} / ${r.extractor}`, r.raw);
      }
    }
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
  dumpDisagreementRaws(report.results);
}

/**
 * Fixture names grouped under their extractor, one group per line.
 *
 * Flat, the list is ~20 hyphenated names in one paragraph; grouped, an operator
 * who knows which extractor failed reads only that line.
 */
function formatFixtureList(
  fixtures: ReadonlyArray<{ readonly name: string; readonly extractor: string }>
): string {
  const byExtractor = new Map<string, string[]>();
  for (const f of fixtures) {
    const names = byExtractor.get(f.extractor) ?? [];
    names.push(f.name);
    byExtractor.set(f.extractor, names);
  }
  return [...byExtractor]
    .map(([extractor, names]) => `  ${extractor}: ${names.join(", ")}`)
    .join("\n");
}

export function addEvalCommands(program: Command): void {
  const cmd = program
    .command("eval")
    .description("Compare extraction models on cost, speed, and correctness");

  cmd
    .command("extract")
    .description("Run golden extraction fixtures across models and rank them")
    // Every value option here takes an OPTIONAL argument so that omitting the
    // value is ours to answer, not Commander's: `--extractor` alone exits with
    // "argument missing" and no hint of what the arguments are, which is exactly
    // the moment an operator needs the list. With `[name]` Commander hands the
    // action `true` instead, and `optionValue` throws with the values.
    .option("--models [csv]", `comma-separated model ids (default: ${DEFAULT_MODELS.join(", ")})`)
    .option(
      "--extractor [name]",
      // Only offer what is actually scorable: an extractor registered in
      // EVAL_EXTRACTORS with no committed fixture has nothing to run.
      `limit to one extractor (${extractorsWithFixtures().join(", ")})`
    )
    .option(
      "--fixture [csv]",
      "limit to these fixtures by name, as printed in the failures list " +
        "(e.g. s1-management-operating-company) — re-run just the one a model failed on"
    )
    .option("--format [fmt]", "table | json (default: table)")
    .option(
      "--print-prompts [mode]",
      `dump extraction prompts and exit (${PRINT_PROMPTS_MODES.join(" | ")}) — no model calls`
    )
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
    .option(
      "--dump-raw",
      "print model JSON on stderr for hard failures and scoring disagreements (also included in --format json)"
    )
    .action(
      async (opts: {
        models?: string | boolean;
        extractor?: string | boolean;
        fixture?: string | boolean;
        format: string | boolean;
        details: boolean;
        runs?: number;
        real?: boolean;
        printPrompts?: string | boolean;
        dumpRaw?: boolean;
      }) => {
        await runCommand(async () => {
          const extractor = optionValue(
            "--extractor",
            opts.extractor,
            () => `one of: ${extractorsWithFixtures().join(", ")}`
          );
          if (extractor && !EVAL_EXTRACTORS[extractor]) {
            throw new Error(
              `unknown extractor "${extractor}"; known: ${Object.keys(EVAL_EXTRACTORS).join(", ")}`
            );
          }
          const fixtures = csvOptionValue(
            "--fixture",
            opts.fixture,
            () =>
              `one or more fixture names:\n` +
              formatFixtureList(availableFixtures({ extractor, real: opts.real }))
          );
          const printMode = requirePrintPromptsMode(opts.printPrompts);
          if (printMode !== undefined) {
            const items: PrintPromptItem[] = printPromptsNeedsSectionText(printMode)
              ? resolveEvalFixtures({
                  extractor,
                  fixtures,
                  real: opts.real === true,
                }).map((f) => ({
                  extractor: f.extractor,
                  label: f.name,
                  sectionText: preparedSectionText(f.extractor, f.text),
                }))
              : (extractor ? [extractor] : Object.keys(EVAL_EXTRACTORS)).map((name) => ({
                  extractor: name,
                  label: name,
                }));
            printEvalPrompts({
              mode: printMode,
              items,
              modelIds: printPromptModelIds(opts.models, DEFAULT_MODELS),
            });
            return;
          }
          const format = requireFormat(opts.format);
          const models = parseModels(
            csvOptionValue("--models", opts.models, () => modelIdsHint(DEFAULT_MODELS))
          );
          // `--runs` keeps a required argument: a count has no list of legal
          // values to print, so Commander's own message says everything ours would.
          const runs = opts.runs;
          if (runs !== undefined && (!Number.isFinite(runs) || runs < 1)) {
            throw new Error(`--runs must be a positive integer; got "${runs}"`);
          }
          const input = {
            models,
            ...(extractor ? { extractor } : {}),
            ...(fixtures ? { fixtures } : {}),
            ...(runs !== undefined ? { runs: Math.trunc(runs) } : {}),
            ...(opts.real ? { real: true } : {}),
            ...(opts.dumpRaw ? { dumpRaw: true } : {}),
          };
          // runWorkflowCli renders the task-graph progress UI on a TTY (clearing
          // it before we print), and runs plainly when piped.
          const report = await runWorkflowCli<EvalReport>([
            new EvalExtractTask({ defaults: input }),
          ]);
          if (format === "json") {
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
    // `[id]`/`[csv]` rather than `<…>`: see the note on `eval extract`.
    // No Commander default on the value options below: with a default set,
    // Commander resolves a value-less `--reference` to that default instead of
    // handing us `true`, which would silently sweep the default where the old
    // required form at least errored. The default is applied in the action.
    .option(
      "--reference [id]",
      `reference (oracle) model id, or 'golden' for committed human-verified labels (default: ${ORACLE_DEFAULT_REFERENCE})`
    )
    .option(
      "--models [csv]",
      `model ids to score against the reference (default: ${ORACLE_DEFAULT_CANDIDATE})`
    )
    .option(
      "--extractors [csv]",
      `sections to pull (${Object.keys(EVAL_EXTRACTORS).join(", ")}); default: every extractor with golden labels that is not excluded from default sweeps (${defaultGoldenSweepExtractors().join(", ")}), or management against a model reference`
    )
    .option(
      "--dir <path>",
      "directory of real S-1 HTML to segment (default: committed mock_data; " +
        "point at mock_data/s1/.cache after `sec fetch s1-fixtures`)"
    )
    .option(
      "--cik [csv]",
      "limit the sweep to these filer CIKs (leading zeros optional) — isolates one " +
        "filing when checking a newly added fixture or label"
    )
    .option("--format [fmt]", "table | json (default: table)")
    .option(
      "--print-prompts [mode]",
      `dump extraction prompts and exit (${PRINT_PROMPTS_MODES.join(" | ")}) — no model calls`
    )
    .option("--no-details", "hide per-row/field disagreements after the table")
    .option(
      "--dump-raw",
      "print model JSON on stderr for hard failures and scoring disagreements (also included in --format json)"
    )
    .option(
      "--effort [level]",
      "override every extractor's baked-in thinking effort for this sweep " +
        "(none|low|medium|high|extra|ultra)"
    )
    // Three axes rather than one number: they multiply, so a single flag can
    // only bound the product by guessing how the operator wants it spent.
    .option(
      "--concurrency-s1 <n>",
      `filings extracted at once (default ${EVAL_S1_CONCURRENCY_DEFAULTS.s1}); ` +
        `s1 x section x section-model = concurrent extractions`,
      parseIntOption
    )
    .option(
      "--concurrency-section <n>",
      `sections of one filing extracted at once (default ${EVAL_S1_CONCURRENCY_DEFAULTS.section}); ` +
        `s1 x section x section-model = concurrent extractions`,
      parseIntOption
    )
    .option(
      "--concurrency-section-model <n>",
      `candidate models scoring one section at once (default ${EVAL_S1_CONCURRENCY_DEFAULTS.sectionModel}); ` +
        `s1 x section x section-model = concurrent extractions`,
      parseIntOption
    )
    .action(
      async (opts: {
        reference: string | boolean;
        models?: string | boolean;
        extractors?: string | boolean;
        dir?: string;
        cik?: string | boolean;
        format: string | boolean;
        details: boolean;
        printPrompts?: string | boolean;
        dumpRaw?: boolean;
        effort?: string | boolean;
        concurrencyS1?: number;
        concurrencySection?: number;
        concurrencySectionModel?: number;
      }) => {
        await runCommand(async () => {
          // Validated here rather than only inside the task so a bad value costs
          // nothing — the sweep loads the corpus and registers models first.
          const concurrencyS1 =
            opts.concurrencyS1 === undefined
              ? undefined
              : resolveEvalS1Concurrency("s1", opts.concurrencyS1);
          const concurrencySection =
            opts.concurrencySection === undefined
              ? undefined
              : resolveEvalS1Concurrency("section", opts.concurrencySection);
          const concurrencySectionModel =
            opts.concurrencySectionModel === undefined
              ? undefined
              : resolveEvalS1Concurrency("sectionModel", opts.concurrencySectionModel);
          const requestedExtractors = csvOptionValue(
            "--extractors",
            opts.extractors,
            // Every EVAL_EXTRACTORS key is legal here (unlike `eval extract`,
            // which needs a committed fixture); which ones have golden labels
            // is in --help, and repeating it doubles the line.
            () => `one or more of: ${Object.keys(EVAL_EXTRACTORS).join(", ")}`
          );
          // The CIK list is the corpus `--dir` selects, so the hint reads the
          // same directory the sweep will.
          const ciks = csvOptionValue(
            "--cik",
            opts.cik,
            () => `one or more filer CIKs: ${availableFixtureCiks(opts.dir).join(", ")}`
          );
          const printMode = requirePrintPromptsMode(opts.printPrompts);
          if (printMode !== undefined) {
            const extractors = requestedExtractors ?? defaultGoldenSweepExtractors();
            for (const name of extractors) {
              if (!EVAL_EXTRACTORS[name]) {
                throw new Error(
                  `unknown extractor "${name}"; known: ${Object.keys(EVAL_EXTRACTORS).join(", ")}`
                );
              }
            }
            if (printPromptsNeedsSectionText(printMode)) {
              const { sections, skipped } = loadRealS1Sections(extractors, opts.dir, ciks);
              if (sections.length === 0) {
                throw new Error(
                  `nothing to print — no S-1 sections matched` +
                    (skipped.length ? ` (${skipped.join("; ")})` : "")
                );
              }
              printEvalPrompts({
                mode: printMode,
                items: sections.map((s) => ({
                  extractor: s.extractor,
                  label: `${s.filing} [${s.extractor}]`,
                  sectionText: preparedSectionText(s.extractor, s.text),
                })),
                modelIds: printPromptModelIds(opts.models, [ORACLE_DEFAULT_CANDIDATE]),
              });
            } else {
              printEvalPrompts({
                mode: printMode,
                items: extractors.map((extractor) => ({ extractor, label: extractor })),
                modelIds: printPromptModelIds(opts.models, [ORACLE_DEFAULT_CANDIDATE]),
              });
            }
            return;
          }
          const format = requireFormat(opts.format);
          const reference =
            optionValue(
              "--reference",
              opts.reference,
              () =>
                `'${GOLDEN_REFERENCE}' for the committed human-verified labels ` +
                `(the default), or a model id to use as an oracle; ` +
                `any id routes by shape: ${KNOWN_MODEL_ID_SHAPES}`
            ) ?? ORACLE_DEFAULT_REFERENCE;
          const candidates = csvOptionValue("--models", opts.models, () =>
            modelIdsHint([ORACLE_DEFAULT_CANDIDATE])
          ) ?? [ORACLE_DEFAULT_CANDIDATE];
          // Under golden truth, default to every extractor that HAS labels —
          // scoring only `management` while committed beneficial-ownership
          // labels sat unused made the default look narrower than the evidence
          // actually available. Extractors flagged out of default sweeps are
          // excluded here (an explicit `--extractors` still runs them). Against
          // a model oracle there is no such coverage signal, so that path keeps
          // its single cheap default.
          const defaultExtractors =
            reference === GOLDEN_REFERENCE ? defaultGoldenSweepExtractors() : ["management"];
          const selectedExtractors = requestedExtractors ?? defaultExtractors;
          for (const name of selectedExtractors) {
            if (!EVAL_EXTRACTORS[name]) {
              throw new Error(
                `unknown extractor "${name}"; known: ${Object.keys(EVAL_EXTRACTORS).join(", ")}`
              );
            }
          }
          const effort = optionValue(
            "--effort",
            opts.effort,
            () => "one of: none, low, medium, high, extra, ultra"
          );
          const input = {
            reference,
            candidates,
            extractors: selectedExtractors,
            ...(opts.dir ? { dir: opts.dir } : {}),
            ...(ciks && ciks.length > 0 ? { ciks } : {}),
            ...(opts.dumpRaw ? { dumpRaw: true } : {}),
            ...(effort ? { effort } : {}),
            ...(concurrencyS1 !== undefined ? { concurrencyS1 } : {}),
            ...(concurrencySection !== undefined ? { concurrencySection } : {}),
            ...(concurrencySectionModel !== undefined ? { concurrencySectionModel } : {}),
          };
          // runWorkflowCli renders the task-graph progress UI on a TTY (clearing
          // it before we print), and runs plainly when piped.
          const report = await runWorkflowCli<OracleReport>([new EvalS1Task({ defaults: input })]);
          if (format === "json") {
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
    .option("--models [csv]", `comma-separated model ids (default: ${DEFAULT_MODELS.join(", ")})`)
    .option(
      "--dir <path>",
      "directory of real S-1 HTML to segment (default: committed mock_data; " +
        "point at mock_data/s1/.cache after `sec fetch s1-fixtures`)"
    )
    .option("--format [fmt]", "table | json (default: table)")
    .option(
      "--print-prompts [mode]",
      `dump extraction prompts and exit (${PRINT_PROMPTS_MODES.join(" | ")}) — no model calls`
    )
    .option("--no-details", "hide per-row/field disagreements after the table")
    .option(
      "--dump-raw",
      "print model JSON on stderr for hard failures and scoring disagreements (also included in --format json)"
    )
    .action(
      async (opts: {
        models?: string | boolean;
        dir?: string;
        format: string | boolean;
        details: boolean;
        printPrompts?: string | boolean;
        dumpRaw?: boolean;
      }) => {
        await runCommand(async () => {
          const printMode = requirePrintPromptsMode(opts.printPrompts);
          if (printMode !== undefined) {
            if (printPromptsNeedsSectionText(printMode)) {
              const { sections, skipped } = loadRealS1Sections(["offering-terms"], opts.dir);
              if (sections.length === 0) {
                throw new Error(
                  `nothing to print — no offering-terms sections` +
                    (skipped.length ? ` (${skipped.join("; ")})` : "")
                );
              }
              printEvalPrompts({
                mode: printMode,
                items: sections.map((s) => ({
                  extractor: "offering-terms",
                  label: s.filing,
                  sectionText: s.text,
                })),
                modelIds: printPromptModelIds(opts.models, DEFAULT_MODELS),
              });
            } else {
              printEvalPrompts({
                mode: printMode,
                items: [{ extractor: "offering-terms", label: "offering-terms" }],
                modelIds: printPromptModelIds(opts.models, DEFAULT_MODELS),
              });
            }
            return;
          }
          const format = requireFormat(opts.format);
          const models = parseModels(
            csvOptionValue("--models", opts.models, () => modelIdsHint(DEFAULT_MODELS))
          );
          const input = {
            models,
            ...(opts.dir ? { dir: opts.dir } : {}),
            ...(opts.dumpRaw ? { dumpRaw: true } : {}),
          };
          const report = await runWorkflowCli<UnitTermsReport>([
            new EvalUnitTermsTask({ defaults: input }),
          ]);
          if (format === "json") {
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
              "est.cost prefers API-stated spend when available; local models are $0. Best-first: correctness, then cost, " +
              "then latency."
          );
          if (report.skipped.length) {
            console.log("\nskipped:");
            for (const sMsg of report.skipped) console.log(`  ${sMsg}`);
          }
        });
      }
    );

  for (const spec of PARSER_EVAL_COMMANDS) {
    cmd
      .command(spec.name)
      .description(spec.description)
      .option("--extractor-id [id]", "limit to S-1 or 424")
      .option("--limit [n]", "max stored rows to score")
      .option("--cik [n]", "limit to one issuer CIK")
      .option("--format [fmt]", "table | json (default: table)")
      .action(
        async (opts: {
          extractorId?: string | boolean;
          limit?: string | boolean;
          cik?: string | boolean;
          format: string | boolean;
        }) => {
          await runCommand(async () => {
            const format = requireFormat(opts.format);
            const extractorRaw = optionValue("--extractor-id", opts.extractorId, () => "S-1, 424");
            if (extractorRaw !== undefined && extractorRaw !== "S-1" && extractorRaw !== "424") {
              throw new Error("--extractor-id needs a value — S-1, 424");
            }
            const limitRaw = optionValue("--limit", opts.limit, () => "a non-negative integer");
            const cikRaw = optionValue("--cik", opts.cik, () => "an issuer CIK");
            const input: ParserEvalInput = {
              ...(extractorRaw ? { extractorId: extractorRaw } : {}),
              ...(limitRaw !== undefined ? { limit: parseIntOption(limitRaw) } : {}),
              ...(cikRaw !== undefined ? { cik: parseIntOption(cikRaw) } : {}),
            };
            const report = await spec.run(input);
            if (format === "json") {
              console.log(JSON.stringify(report, null, 2));
              return;
            }
            printParserEvalReport(spec.label, report);
          });
        }
      );
  }
}

/**
 * The three narrowing options every deterministic-parser eval command takes.
 * A type alias, not an interface: each task's `defaults` is a `DataPorts`
 * subtype, and only an alias picks up the implicit string index signature that
 * assignment needs.
 */
type ParserEvalInput = {
  readonly extractorId?: string;
  readonly limit?: number;
  readonly cik?: number;
};

/**
 * The `sec eval <parser>` commands that score a deterministic parser against
 * the rows already stored for a filing. They differ only in which task runs and
 * how the table is labelled, so they are declared rather than repeated: ten
 * copies of the same option parsing drifted apart the moment one was edited.
 */
const PARSER_EVAL_COMMANDS: ReadonlyArray<{
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly run: (defaults: ParserEvalInput) => Promise<ParserEvalReport>;
}> = [
  {
    name: "offering-tables",
    label: "offering/promote",
    description:
      "Score the deterministic SPAC offering/promote table parser against stored rows (on-disk cache only; no EDGAR fetch)",
    run: (defaults) =>
      runWorkflowCli<OfferingTablesReport>([new EvalOfferingTablesTask({ defaults })]),
  },
  {
    name: "underwriters",
    label: "underwriters",
    description:
      "Score the deterministic SPAC underwriter table parser against stored rows (on-disk cache only; no EDGAR fetch)",
    run: (defaults) => runWorkflowCli<UnderwritersReport>([new EvalUnderwritersTask({ defaults })]),
  },
  {
    name: "use-of-proceeds",
    label: "use-of-proceeds",
    description:
      "Score the deterministic SPAC use-of-proceeds table parser against stored rows (on-disk cache only; no EDGAR fetch)",
    run: (defaults) =>
      runWorkflowCli<UseOfProceedsReport>([new EvalUseOfProceedsTask({ defaults })]),
  },
  {
    name: "executive-compensation",
    label: "executive-compensation",
    description:
      "Score the deterministic Summary Compensation Table parser against stored rows (on-disk cache only; no EDGAR fetch)",
    run: (defaults) =>
      runWorkflowCli<ExecutiveCompensationReport>([
        new EvalExecutiveCompensationTask({ defaults }),
      ]),
  },
  {
    name: "beneficial-ownership",
    label: "beneficial-ownership",
    description:
      "Score the deterministic beneficial-ownership parser against stored rows (on-disk cache only; no EDGAR fetch)",
    run: (defaults) =>
      runWorkflowCli<BeneficialOwnershipReport>([new EvalBeneficialOwnershipTask({ defaults })]),
  },
  {
    name: "management",
    label: "management",
    description:
      "Score the deterministic management roster parser against stored rows (on-disk cache only; no EDGAR fetch)",
    run: (defaults) => runWorkflowCli<ManagementReport>([new EvalManagementTask({ defaults })]),
  },
  {
    name: "related-party",
    label: "related-party",
    description:
      "Score the deterministic related-party table parser against stored rows (on-disk cache only; no EDGAR fetch)",
    run: (defaults) => runWorkflowCli<RelatedPartyReport>([new EvalRelatedPartyTask({ defaults })]),
  },
  {
    name: "spac-sponsors",
    label: "spac-sponsors",
    description:
      "Score the deterministic SPAC sponsor parser against stored rows (on-disk cache only; no EDGAR fetch)",
    run: (defaults) => runWorkflowCli<SpacSponsorsReport>([new EvalSpacSponsorsTask({ defaults })]),
  },
  {
    name: "spac-profile",
    label: "spac-profile",
    description:
      "Score the deterministic SPAC profile parser against stored rows (on-disk cache only; no EDGAR fetch)",
    run: (defaults) => runWorkflowCli<SpacProfileReport>([new EvalSpacProfileTask({ defaults })]),
  },
  {
    name: "spac-classification",
    label: "spac-classification",
    description:
      "Score the deterministic SPAC classifier against stored rows (on-disk cache only; no EDGAR fetch)",
    run: (defaults) =>
      runWorkflowCli<SpacClassificationReport>([new EvalSpacClassificationTask({ defaults })]),
  },
];
