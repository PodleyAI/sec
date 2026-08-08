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
import { EVAL_EXTRACTORS, EVAL_FIXTURES, type EvalFixture } from "./fixtures";
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
}

/** Extractor ids that actually have at least one committed fixture. */
export function extractorsWithFixtures(): string[] {
  return [...new Set(EVAL_FIXTURES.map((f) => f.extractor))];
}

function selectFixtures(extractor: string | undefined): EvalFixture[] {
  const all = [...EVAL_FIXTURES];
  if (extractor === undefined) return all;
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

async function runOne(
  modelId: string,
  model: ModelConfig,
  fixture: EvalFixture,
  context: IExecuteContext | undefined,
  run: number
): Promise<FixtureRunResult> {
  const extractor = EVAL_EXTRACTORS[fixture.extractor];
  const promptChars = fixture.text.length + extractor.instructionOverheadChars;
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
  const fixtures = selectFixtures(opts.extractor);
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
              run
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
