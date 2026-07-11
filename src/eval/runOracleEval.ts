/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { getGlobalModelRepository } from "workglow";
import { registerModelIds } from "../config/registerModels";
import { EVAL_EXTRACTORS } from "./fixtures";
import { estimateCost, type CostEstimate } from "./modelPricing";
import { loadRealS1Sections, type RealSection } from "./realSections";
import { scoreExtraction, type ExtractionScore } from "./scoreExtraction";

export interface OracleRunResult {
  readonly filing: string;
  readonly extractor: string;
  readonly model: string;
  readonly ok: boolean;
  readonly error: string | undefined;
  readonly latencyMs: number;
  readonly rows: number;
  readonly cost: CostEstimate;
  /** Agreement with the reference; null for the reference model's own runs. */
  readonly score: ExtractionScore | null;
}

export interface OracleModelSummary {
  readonly model: string;
  readonly provider: string;
  readonly role: "reference" | "candidate";
  readonly runs: number;
  readonly okRuns: number;
  /** Mean field-level agreement with the reference (candidates only). */
  readonly avgAgreement: number;
  /** Mean fraction of the reference's entities the model also found. */
  readonly avgEntityRecall: number;
  /** Mean fraction of the model's entities the reference also had (1 − hallucination). */
  readonly avgPrecision: number;
  readonly avgLatencyMs: number;
  readonly totalRows: number;
  /**
   * Distinct rows after de-duplicating on the extractor's key field, summed
   * across scored sections (candidates only; equals {@link totalRows} for the
   * reference). The gap between this and {@link totalRows} is the model's
   * duplicate over-production, which no longer counts against precision.
   */
  readonly totalDistinctRows: number;
  readonly totalUsd: number | null;
}

export interface OracleReport {
  readonly reference: string;
  readonly sections: number;
  readonly skipped: readonly string[];
  readonly results: readonly OracleRunResult[];
  readonly summaries: readonly OracleModelSummary[];
}

/** How many times to (re)try the reference extraction before giving up on a section. */
const REFERENCE_MAX_ATTEMPTS = 3;

export interface RunOracleOptions {
  readonly reference: string;
  readonly candidates: readonly string[];
  /** Extractor names whose real sections to pull (default: management). */
  readonly extractors?: readonly string[];
  /** Directory of real S-1 HTML to segment (default: the committed mock_data dir). */
  readonly dir?: string;
  /**
   * Optional progress sink, invoked once per section per model as the sweep
   * runs (`done` of `total`). The oracle is otherwise silent until the final
   * report, which makes a long local-model run (minutes per large section) look
   * hung; the CLI wires this to the task-graph progress UI.
   */
  readonly onProgress?: (done: number, total: number, message: string) => void;
  /** When aborted, the sweep stops after the current section and reports what ran. */
  readonly signal?: AbortSignal;
}

async function runSection(
  modelId: string,
  model: ModelConfig,
  section: RealSection
): Promise<{ rows: unknown[]; result: Omit<OracleRunResult, "score"> }> {
  const extractor = EVAL_EXTRACTORS[section.extractor];
  const promptChars = section.text.length + extractor.instructionOverheadChars;
  const t0 = Bun.nanoseconds();
  try {
    const rows = await extractor.run(section.text, model);
    const latencyMs = (Bun.nanoseconds() - t0) / 1e6;
    return {
      rows,
      result: {
        filing: section.filing,
        extractor: section.extractor,
        model: modelId,
        ok: true,
        error: undefined,
        latencyMs,
        rows: rows.length,
        cost: estimateCost(modelId, promptChars, JSON.stringify(rows).length),
      },
    };
  } catch (err) {
    const latencyMs = (Bun.nanoseconds() - t0) / 1e6;
    return {
      rows: [],
      result: {
        filing: section.filing,
        extractor: section.extractor,
        model: modelId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs,
        rows: 0,
        cost: estimateCost(modelId, promptChars, 0),
      },
    };
  }
}

function summarize(
  modelId: string,
  provider: string,
  role: "reference" | "candidate",
  rows: OracleRunResult[]
): OracleModelSummary {
  const n = rows.length || 1;
  const scored = rows.filter((r) => r.score !== null);
  const sn = scored.length || 1;
  const anyUnknownCost = rows.some((r) => r.cost.usd === null);
  // Reference runs carry no score (candidateDistinct), so fall back to their raw
  // row count; candidate runs report distinct rows from the scorer's dedupe.
  const totalDistinctRows = rows.reduce((s, r) => s + (r.score?.candidateDistinct ?? r.rows), 0);
  return {
    model: modelId,
    provider,
    role,
    runs: rows.length,
    okRuns: rows.filter((r) => r.ok).length,
    avgAgreement: scored.reduce((s, r) => s + (r.score?.score ?? 0), 0) / sn,
    avgEntityRecall: scored.reduce((s, r) => s + (r.score?.entityRecall ?? 0), 0) / sn,
    avgPrecision: scored.reduce((s, r) => s + (r.score?.precision ?? 0), 0) / sn,
    avgLatencyMs: rows.reduce((s, r) => s + r.latencyMs, 0) / n,
    totalRows: rows.reduce((s, r) => s + r.rows, 0),
    totalDistinctRows,
    totalUsd: anyUnknownCost ? null : rows.reduce((s, r) => s + (r.cost.usd ?? 0), 0),
  };
}

/**
 * Oracle comparison over **real committed S-1 sections**: the `reference` model
 * (e.g. sonnet-5) extracts each section to establish the "truth", then every
 * `candidate` extracts the same section and is scored on how closely it agrees
 * with the reference (field agreement, entity recall, precision). This answers
 * "can a cheap/local model stand in for sonnet on real filings?" without hand-
 * labeling every section. Runs sequentially (models share a local HFT worker and
 * cloud limits). A section the reference itself fails on is not scored.
 */
export async function runOracleEval(opts: RunOracleOptions): Promise<OracleReport> {
  const extractorNames = opts.extractors?.length ? opts.extractors : ["management"];
  await registerModelIds([opts.reference, ...opts.candidates]);
  const repo = getGlobalModelRepository();
  const { sections, skipped } = loadRealS1Sections(extractorNames, opts.dir);

  const refModel = (await repo.findByName(opts.reference)) as ModelConfig | undefined;
  const results: OracleRunResult[] = [];
  const perModel = new Map<string, OracleRunResult[]>();
  const push = (r: OracleRunResult): void => {
    results.push(r);
    (perModel.get(r.model) ?? perModel.set(r.model, []).get(r.model)!).push(r);
  };
  const progress = opts.onProgress ?? ((): void => {});
  const kchars = (n: number): string => `${(n / 1000).toFixed(0)}k`;
  // One step per model run: the reference (when it resolved) plus every candidate.
  const total = sections.length * ((refModel ? 1 : 0) + opts.candidates.length);
  let done = 0;

  progress(
    done,
    total,
    `oracle: ${sections.length} section(s) × (1 reference + ${opts.candidates.length} candidate(s))`
  );
  for (let si = 0; si < sections.length; si++) {
    if (opts.signal?.aborted) break;
    const section = sections[si];
    const tag = `[${si + 1}/${sections.length}] ${section.filing} ${section.extractor} (${kchars(section.text.length)})`;
    // Reference establishes truth for this section. Retry on failure: strong
    // models intermittently emit a nested array as a JSON *string* (which the
    // strict schema rejects), so a couple of retries recover most sections
    // rather than dropping them from the comparison.
    let refRows: unknown[] = [];
    let refOk = false;
    if (refModel) {
      let outcome = await runSection(opts.reference, refModel, section);
      for (let attempt = 1; !outcome.result.ok && attempt < REFERENCE_MAX_ATTEMPTS; attempt++) {
        outcome = await runSection(opts.reference, refModel, section);
      }
      refRows = outcome.rows;
      refOk = outcome.result.ok;
      push({ ...outcome.result, score: null });
      done += 1;
      progress(
        done,
        total,
        `${tag} ref ${opts.reference}: ${refOk ? "ok" : "FAIL"} ${outcome.result.latencyMs.toFixed(0)}ms ${outcome.result.rows} rows`
      );
    }
    const extractor = EVAL_EXTRACTORS[section.extractor];
    const expected = refRows as Record<string, unknown>[];
    for (const candidateId of opts.candidates) {
      const candModel = (await repo.findByName(candidateId)) as ModelConfig | undefined;
      if (!candModel) {
        push({
          filing: section.filing,
          extractor: section.extractor,
          model: candidateId,
          ok: false,
          error: `model "${candidateId}" not registered`,
          latencyMs: 0,
          rows: 0,
          cost: estimateCost(candidateId, 0, 0),
          score: null,
        });
        done += 1;
        continue;
      }
      const { rows, result } = await runSection(candidateId, candModel, section);
      // Only score when the reference produced a usable truth for this section.
      const score = refOk
        ? scoreExtraction(rows, expected, {
            keyField: extractor.keyField,
            fields: extractor.compareFields,
          })
        : null;
      push({ ...result, score });
      done += 1;
      const agree = score ? ` agree ${(score.score * 100).toFixed(0)}%` : "";
      progress(
        done,
        total,
        `${tag} cand ${candidateId}: ${result.ok ? "ok" : "FAIL"} ${result.latencyMs.toFixed(0)}ms ${result.rows} rows${agree}`
      );
    }
  }

  const summaries: OracleModelSummary[] = [];
  for (const [modelId, rows] of perModel) {
    const model = (await repo.findByName(modelId)) as { provider?: string } | undefined;
    const role = modelId === opts.reference ? "reference" : "candidate";
    summaries.push(summarize(modelId, model?.provider ?? "unknown", role, rows));
  }
  // Reference first, then candidates ranked by agreement desc.
  summaries.sort((a, b) => {
    if (a.role !== b.role) return a.role === "reference" ? -1 : 1;
    return b.avgAgreement - a.avgAgreement || a.avgLatencyMs - b.avgLatencyMs;
  });

  return { reference: opts.reference, sections: sections.length, skipped, results, summaries };
}
