/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { getGlobalModelRepository } from "workglow";
import { registerModelIds } from "../config/registerModels";
import { EVAL_EXTRACTORS, EVAL_FIXTURES, type EvalFixture } from "./fixtures";
import { estimateCost, type CostEstimate } from "./modelPricing";
import { scoreExtraction, type ExtractionScore } from "./scoreExtraction";

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
}

export interface RunEvalOptions {
  readonly models: readonly string[];
  /** Restrict to one extractor (e.g. `management`); default runs every fixture. */
  readonly extractor?: string;
}

function selectFixtures(extractor: string | undefined): EvalFixture[] {
  const all = [...EVAL_FIXTURES];
  return extractor ? all.filter((f) => f.extractor === extractor) : all;
}

function makeCtx(): any {
  return {
    signal: new AbortController().signal,
    updateProgress: async () => {},
    own: <T>(v: T): T => v,
    registry: {
      has: () => false,
      get: () => {
        throw new Error("not registered");
      },
    },
    resourceScope: { register: () => {}, dispose: async () => {} },
  };
}

async function runOne(
  modelId: string,
  model: ModelConfig,
  fixture: EvalFixture
): Promise<FixtureRunResult> {
  const extractor = EVAL_EXTRACTORS[fixture.extractor];
  const promptChars = fixture.text.length + extractor.instructionOverheadChars;
  const t0 = Bun.nanoseconds();
  try {
    const rows = await extractor.run(fixture.text, model);
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
    };
  }
}

function summarize(modelId: string, provider: string, rows: FixtureRunResult[]): ModelSummary {
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
  await registerModelIds(opts.models);
  const repo = getGlobalModelRepository();
  const fixtures = selectFixtures(opts.extractor);

  const results: FixtureRunResult[] = [];
  const summaries: ModelSummary[] = [];

  for (const modelId of opts.models) {
    const model = (await repo.findByName(modelId)) as ModelConfig | undefined;
    const provider = (model as { provider?: string } | undefined)?.provider ?? "unknown";
    const modelRows: FixtureRunResult[] = [];
    for (const fixture of fixtures) {
      const result = model
        ? await runOne(modelId, model, fixture)
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
          } satisfies FixtureRunResult);
      results.push(result);
      modelRows.push(result);
    }
    summaries.push(summarize(modelId, provider, modelRows));
  }

  summaries.sort(
    (a, b) =>
      b.avgScore - a.avgScore ||
      (a.totalUsd ?? Infinity) - (b.totalUsd ?? Infinity) ||
      a.avgLatencyMs - b.avgLatencyMs
  );

  return { results, summaries };
}
