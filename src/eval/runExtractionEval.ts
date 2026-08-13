/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, ModelConfig } from "workglow";
import { getGlobalModelRepository } from "workglow";
import { registerModelIds } from "../config/registerModels";
import { prefetchModel } from "../task/model/EnsureModelDownloadedTask";
import { sweepStepContext } from "./evalProgressContext";
import { fingerprintRows } from "./fingerprintRows";
import { loadRealS1Sections } from "./realSections";
import { EVAL_EXTRACTORS, EVAL_FIXTURES, estimateExtractionPromptChars, type EvalFixture } from "./fixtures";
import {
  captureEvalRawFromError,
  captureEvalRawFromRows,
  type EvalRawDump,
} from "./captureEvalRaw";
import { estimateCost, type CostEstimate } from "./modelPricing";
import { scoreExtraction, type ExtractionScore } from "./scoreExtraction";
import { unloadLocalModel } from "./unloadModel";

export interface FixtureRunResult {
  readonly model: string;
  readonly fixture: string;
  readonly extractor: string;
  readonly ok: boolean;
  readonly error: string | undefined;
  readonly latencyMs: number;
  readonly rows: number;
  readonly score: ExtractionScore;
  readonly cost: CostEstimate;
  /** 1-based repetition index; always 1 unless `runs` was raised. */
  readonly run: number;
  /** Digest of the rows including citations (`source_span`, `confidence`). */
  readonly fingerprint: string;
  /** Digest of the extracted facts only — citations excluded. */
  readonly contentFingerprint: string;
  /** Present only when the sweep was run with `dumpRaw: true`. */
  readonly raw: EvalRawDump | undefined;
}

/**
 * How reproducible one model's extractions were across repeated runs of the
 * same fixture. Reported only when `runs > 1`.
 *
 * The two counts answer different questions. `stableContent` is whether the
 * model found the same facts; `stableExact` additionally requires it to have
 * cited them the same way. On real filings the first has been much higher than
 * the second — the same risks cut at different points — so collapsing them into
 * one number would hide where the variance actually lives.
 */
export interface StabilitySummary {
  readonly model: string;
  /** Fixtures the sweep touched at all, complete or not. */
  readonly fixtures: number;
  /**
   * Fixtures that completed all `runs` repetitions — the only ones the
   * stability counts are computed over, and therefore the only honest
   * denominator for them. Reporting `stableExact` against {@link fixtures}
   * read an interrupted sweep as an unreproducible one: `same 3/5` says two
   * fixtures were measured and disagreed with themselves, when in fact they
   * were never measured twice.
   */
  readonly measured: number;
  readonly stableExact: number;
  readonly stableContent: number;
  readonly runs: number;
}

export interface ModelSummary {
  readonly model: string;
  readonly provider: string;
  readonly runs: number;
  readonly okRuns: number;
  readonly avgScore: number;
  readonly avgEntityRecall: number;
  readonly avgPrecision: number;
  readonly avgLatencyMs: number;
  /** Total estimated USD across fixtures, or null if any model's pricing is unknown. */
  readonly totalUsd: number | null;
}

export interface EvalReport {
  readonly results: readonly FixtureRunResult[];
  readonly summaries: readonly ModelSummary[];
  /** Present only when the sweep repeated fixtures (`runs > 1`). */
  readonly stability?: readonly StabilitySummary[];
}

export interface RunEvalOptions {
  readonly models: readonly string[];
  /** Restrict to one extractor (e.g. `management`); default runs every fixture. */
  readonly extractor?: string;
  /**
   * Restrict to named fixtures (e.g. `s1-management-operating-company`), the way
   * `sec eval s1 --cik` narrows to one filer: re-running the single fixture a
   * model failed on, without paying for the ones that already passed.
   */
  readonly fixtures?: readonly string[];
  /**
   * Sweep the real committed S-1 sections instead of the curated miniatures.
   * Correctness is not scored (no golden labels at that size); reproducibility,
   * latency and cost are.
   */
  readonly real?: boolean;
  /**
   * Repeat every fixture this many times per model to measure reproducibility.
   * Defaults to 1 (no repetition), which keeps the existing correctness sweep
   * unchanged in both cost and output.
   */
  readonly runs?: number;
  /**
   * Optional progress sink, invoked once per (model, fixture) as the sweep runs
   * (`done` of `total`). The CLI wires this to the task-graph progress UI so a
   * multi-model cloud sweep isn't silent until the final table.
   */
  readonly onProgress?: (done: number, total: number, message: string) => void;
  /** When aborted, the sweep stops after the current run and reports what ran. */
  readonly signal?: AbortSignal;
  /**
   * The running task's execute context. When present, a local model's weights are
   * prefetched through it so the download's progress renders in the CLI task UI
   * (and Ctrl-C aborts the fetch), and every extraction's generation task is
   * owned onto the running task's subgraph rather than a throwaway stub — so it
   * inherits the registry/abort signal and its phase progress reaches the task
   * row. Omitted by direct callers (tests); the download then falls back to the
   * per-section safety-net in `runStructured`.
   */
  readonly context?: IExecuteContext;
  /** Retain model payloads on each result for CLI `--dump-raw`. */
  readonly dumpRaw?: boolean;
}

/** Extractor ids that actually have at least one committed fixture and are eval-enabled. */
export function extractorsWithFixtures(): string[] {
  return [
    ...new Set(
      EVAL_FIXTURES.map((f) => f.extractor).filter((name) => !EVAL_EXTRACTORS[name]?.disabled)
    ),
  ];
}

/**
 * The fixtures a sweep with these flags would run, name + extractor only.
 *
 * Selection runs through the same two paths the sweep itself uses, so `--real`
 * lists the real-section names (`<filing> [<extractor>]`) rather than the
 * miniatures, and `--extractor` narrows the list. This backs the CLI's
 * "you didn't say which" error — telling an operator a value is missing without
 * telling them the values is the part that sends them to the source.
 */
export function availableFixtures(opts: {
  readonly extractor?: string | undefined;
  readonly real?: boolean | undefined;
}): ReadonlyArray<{ readonly name: string; readonly extractor: string }> {
  const selected = opts.real ? realSectionFixtures(opts.extractor) : selectFixtures(opts.extractor);
  return selected.map((f) => ({ name: f.name, extractor: f.extractor }));
}

/**
 * Fixtures built from the REAL committed S-1 sections rather than the curated
 * miniatures.
 *
 * The committed fixtures are 1–4k chars; the sections this pipeline actually
 * runs on are 12k–275k, and every reproducibility problem found so far lives in
 * the big ones — a 246k-char risk-factor list that varies by a few captions per
 * run, a 275k-char promote input whose figures are not all present in it. A
 * sweep over miniatures cannot see any of that.
 *
 * These carry no golden rows, so correctness is NOT scored here — there are no
 * hand-verified labels for a 246k-char section, which is exactly why
 * `sec eval s1` scores against a reference model instead. What they measure
 * without labels is reproducibility, latency and cost, because comparing runs
 * to each other needs no ground truth.
 */
function realSectionFixtures(extractor: string | undefined): EvalFixture[] {
  const names = extractor ? [extractor] : Object.keys(EVAL_EXTRACTORS);
  const { sections, skipped } = loadRealS1Sections(names);
  if (sections.length === 0) {
    throw new Error(
      `no real S-1 sections available for ${extractor ?? "any extractor"}` +
        (skipped.length ? ` — ${skipped.join("; ")}` : "")
    );
  }
  return sections.map((s) => ({
    name: `${s.filing} [${s.extractor}]`,
    extractor: s.extractor,
    text: s.text,
    expected: [],
  }));
}

function selectFixtures(extractor: string | undefined): EvalFixture[] {
  const all = [...EVAL_FIXTURES];
  if (extractor === undefined) {
    // Default sweep skips disabled extractors (e.g. risk-factors); an explicit
    // `--extractor risk-factors` still selects them below.
    return all.filter((f) => !EVAL_EXTRACTORS[f.extractor]?.disabled);
  }
  const selected = all.filter((f) => f.extractor === extractor);
  // Registration in EVAL_EXTRACTORS does not imply a committed fixture — the CLI
  // validates the name against that map, so an unfixtured extractor would sweep
  // zero runs and print an empty table with exit 0, indistinguishable from a
  // passing evaluation. Fail loudly; the fix is to commit a fixture.
  if (selected.length === 0) {
    throw new Error(
      `extractor "${extractor}" has no fixtures in EVAL_FIXTURES — nothing to score. ` +
        `Add one to src/eval/fixtures.ts. Extractors with fixtures: ` +
        `${extractorsWithFixtures().join(", ")}`
    );
  }
  return selected;
}

/**
 * Narrow an already-selected fixture set to the named ones.
 *
 * A name matching nothing is an error listing what is available, not an empty
 * sweep: a zero-fixture run prints a table with no rows and exits 0, which reads
 * exactly like a passing evaluation — the same trap `--extractor` and
 * `sec eval s1 --cik` already refuse to fall into.
 */
function filterByName(fixtures: EvalFixture[], names: readonly string[]): EvalFixture[] {
  const wanted = new Set(names);
  const selected = fixtures.filter((f) => wanted.has(f.name));
  const missing = names.filter((n) => !fixtures.some((f) => f.name === n));
  if (missing.length > 0) {
    throw new Error(
      `no fixture named ${missing.map((m) => `"${m}"`).join(", ")} in this sweep — ` +
        `available: ${fixtures.map((f) => f.name).join(", ")}`
    );
  }
  return selected;
}

export function resolveEvalFixtures(opts: {
  readonly extractor?: string | undefined;
  readonly fixtures?: readonly string[] | undefined;
  readonly real?: boolean | undefined;
}): EvalFixture[] {
  const selected = opts.real ? realSectionFixtures(opts.extractor) : selectFixtures(opts.extractor);
  return opts.fixtures && opts.fixtures.length > 0
    ? filterByName(selected, opts.fixtures)
    : selected;
}

async function runOne(
  modelId: string,
  model: ModelConfig,
  fixture: EvalFixture,
  context: IExecuteContext | undefined,
  run: number,
  dumpRaw: boolean
): Promise<FixtureRunResult> {
  const extractor = EVAL_EXTRACTORS[fixture.extractor];
  const promptChars = estimateExtractionPromptChars(extractor.instructions(), fixture.text);
  const t0 = Bun.nanoseconds();
  try {
    const rows = await extractor.run(fixture.text, model, context);
    const latencyMs = (Bun.nanoseconds() - t0) / 1e6;
    const score = scoreExtraction(rows, fixture.expected, { keyField: extractor.keyField });
    const cost = estimateCost(modelId, promptChars, JSON.stringify(rows).length);
    return {
      model: modelId,
      fixture: fixture.name,
      extractor: fixture.extractor,
      ok: true,
      error: undefined,
      latencyMs,
      rows: rows.length,
      score,
      cost,
      run,
      fingerprint: fingerprintRows(rows, true),
      contentFingerprint: fingerprintRows(rows, false),
      raw: captureEvalRawFromRows(dumpRaw, rows),
    };
  } catch (err) {
    const latencyMs = (Bun.nanoseconds() - t0) / 1e6;
    return {
      model: modelId,
      fixture: fixture.name,
      extractor: fixture.extractor,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs,
      rows: 0,
      score: scoreExtraction([], fixture.expected, { keyField: extractor.keyField }),
      cost: estimateCost(modelId, promptChars, 0),
      run,
      // A failed run has no rows to fingerprint. Give it a distinct sentinel
      // rather than the empty-set digest, so two failures are not mistaken for
      // two runs that reproducibly agreed on extracting nothing.
      fingerprint: `error:${run}`,
      contentFingerprint: `error:${run}`,
      raw: captureEvalRawFromError(dumpRaw, err),
    };
  }
}

/**
 * Per-model reproducibility: for each fixture, whether every repetition agreed.
 * A fixture whose runs disagree counts once, regardless of how many differed —
 * the question is "is this fixture reproducible on this model", not "how many
 * ways did it vary".
 */
export function summarizeStability(
  results: readonly FixtureRunResult[],
  runs: number
): StabilitySummary[] {
  const byModel = new Map<string, Map<string, FixtureRunResult[]>>();
  for (const r of results) {
    let fixtures = byModel.get(r.model);
    if (fixtures === undefined) {
      fixtures = new Map<string, FixtureRunResult[]>();
      byModel.set(r.model, fixtures);
    }
    const group = fixtures.get(r.fixture);
    if (group === undefined) fixtures.set(r.fixture, [r]);
    else group.push(r);
  }
  const out: StabilitySummary[] = [];
  for (const [model, fixtures] of byModel) {
    let stableExact = 0;
    let stableContent = 0;
    let measured = 0;
    for (const group of fixtures.values()) {
      // A fixture that did not complete all `runs` repetitions (Ctrl-C mid
      // sweep) proves nothing about reproducibility: a lone recorded run
      // trivially agrees with itself, and counting it would report an aborted
      // sweep as more reproducible than a finished one. It is excluded from
      // the denominator too, and reported separately as skipped — leaving it
      // in read as "measured and found unreproducible", the opposite of what
      // happened.
      if (group.length < runs) continue;
      measured += 1;
      if (new Set(group.map((g) => g.fingerprint)).size === 1) stableExact += 1;
      if (new Set(group.map((g) => g.contentFingerprint)).size === 1) stableContent += 1;
    }
    out.push({ model, fixtures: fixtures.size, measured, stableExact, stableContent, runs });
  }
  return out;
}

/** Aggregate one model's per-run results into the ranked summary row (shared with `sec eval unit-terms`). */
export function summarizeModelRuns(
  modelId: string,
  provider: string,
  rows: FixtureRunResult[]
): ModelSummary {
  const okRows = rows.filter((r) => r.ok);
  const n = rows.length || 1;
  const avg = (pick: (r: FixtureRunResult) => number): number =>
    rows.reduce((s, r) => s + pick(r), 0) / n;
  const anyUnknownCost = rows.some((r) => r.cost.usd === null);
  return {
    model: modelId,
    provider,
    runs: rows.length,
    okRuns: okRows.length,
    avgScore: avg((r) => r.score.score),
    avgEntityRecall: avg((r) => r.score.entityRecall),
    avgPrecision: avg((r) => r.score.precision),
    avgLatencyMs: avg((r) => r.latencyMs),
    totalUsd: anyUnknownCost ? null : rows.reduce((s, r) => s + (r.cost.usd ?? 0), 0),
  };
}

/**
 * Runs every selected fixture through every candidate model **sequentially**
 * (models share a single local HFT worker and cloud rate limits, so parallelism
 * buys little and muddies latency), scoring correctness and estimating cost.
 * A model that fails to resolve or errors on a fixture is recorded as a failed
 * run rather than aborting the sweep. Summaries are ranked best-first:
 * correctness (score) desc, then cheaper, then faster.
 */
export async function runExtractionEval(opts: RunEvalOptions): Promise<EvalReport> {
  // Select first: an unscorable extractor should fail before we register models.
  const fixtures = resolveEvalFixtures(opts);
  await registerModelIds(opts.models);
  const repo = getGlobalModelRepository();

  const results: FixtureRunResult[] = [];
  const summaries: ModelSummary[] = [];
  const progress = opts.onProgress ?? ((): void => {});
  const runs = Math.max(1, Math.trunc(opts.runs ?? 1));
  const total = opts.models.length * fixtures.length * runs;
  let done = 0;

  for (const modelId of opts.models) {
    if (opts.signal?.aborted) break;
    const model = (await repo.findByName(modelId)) as ModelConfig | undefined;
    const provider = (model as { provider?: string } | undefined)?.provider ?? "unknown";
    // Fetch a local model's weights before the timed loop so download time is not
    // charged to the first fixture's latency, and its progress renders in the CLI
    // task UI. Best-effort: a failed download is surfaced per-fixture as a failed
    // run rather than aborting the whole sweep.
    await prefetchModel(modelId, opts.context);
    const modelRows: FixtureRunResult[] = [];
    for (const fixture of fixtures) {
      if (opts.signal?.aborted) break;
      for (let run = 1; run <= runs; run++) {
        if (opts.signal?.aborted) break;
        const label =
          runs > 1
            ? `${modelId} — ${fixture.name} (run ${run}/${runs})`
            : `${modelId} — ${fixture.name}`;
        progress(done, total, label);
        const result = model
          ? await runOne(
              modelId,
              model,
              fixture,
              sweepStepContext(opts.context, Math.floor((done / (total || 1)) * 100), label),
              run,
              opts.dumpRaw === true
            )
          : ({
              model: modelId,
              fixture: fixture.name,
              extractor: fixture.extractor,
              ok: false,
              error: `model "${modelId}" not registered`,
              latencyMs: 0,
              rows: 0,
              score: scoreExtraction([], fixture.expected, {
                keyField: EVAL_EXTRACTORS[fixture.extractor].keyField,
              }),
              cost: estimateCost(modelId, 0, 0),
              run,
              fingerprint: `unregistered:${run}`,
              contentFingerprint: `unregistered:${run}`,
              raw: captureEvalRawFromError(opts.dumpRaw === true, new Error(`model "${modelId}" not registered`)),
            } satisfies FixtureRunResult);
        results.push(result);
        modelRows.push(result);
        done += 1;
        progress(
          done,
          total,
          `${modelId} — ${fixture.name} (score ${(result.score.score * 100).toFixed(0)}%)`
        );
      }
    }
    summaries.push(summarizeModelRuns(modelId, provider, modelRows));
    // Free a local model's memory before the next candidate loads, so a sweep
    // doesn't accumulate VRAM/RAM across models (no-op for cloud providers).
    if (model) await unloadLocalModel(model);
  }

  summaries.sort(
    (a, b) =>
      b.avgScore - a.avgScore ||
      (a.totalUsd ?? Infinity) - (b.totalUsd ?? Infinity) ||
      a.avgLatencyMs - b.avgLatencyMs
  );

  return runs > 1
    ? { results, summaries, stability: summarizeStability(results, runs) }
    : { results, summaries };
}
