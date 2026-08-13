/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, ModelConfig } from "workglow";
import {
  captureEvalRawFromError,
  captureEvalRawFromRows,
  type EvalRawDump,
} from "../../eval/captureEvalRaw";
import { EVAL_EXTRACTORS, estimateExtractionPromptChars } from "../../eval/fixtures";
import { estimateCost, type CostEstimate } from "../../eval/modelPricing";
import type { RealSection } from "../../eval/realSections";
import type { ExtractionScore } from "../../eval/scoreExtraction";

/** Sentinel `reference` value selecting committed human-verified golden labels. */
export const GOLDEN_REFERENCE = "golden";

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
  /** Present only when the sweep was run with `dumpRaw: true`. */
  readonly raw: EvalRawDump | undefined;
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
export const REFERENCE_MAX_ATTEMPTS = 3;

export async function runSection(
  modelId: string,
  model: ModelConfig,
  section: RealSection,
  context: IExecuteContext | undefined,
  dumpRaw: boolean
): Promise<{ rows: unknown[]; result: Omit<OracleRunResult, "score"> }> {
  const extractor = EVAL_EXTRACTORS[section.extractor];
  const promptChars = estimateExtractionPromptChars(extractor.instructions(), section.text);
  const t0 = Bun.nanoseconds();
  try {
    const rows = await extractor.run(section.text, model, context);
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
        raw: captureEvalRawFromRows(dumpRaw, rows),
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
        raw: captureEvalRawFromError(dumpRaw, err),
      },
    };
  }
}

export function summarize(
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
 * Workflow PROPERTY_ARRAY merge wraps the MapTask's `results` array in one
 * extra array slot. Map `flatten` may already have concatenated per-iteration
 * arrays. Accept either shape.
 */
export function collectMappedResults<T>(runOutput: {
  readonly results?: readonly unknown[];
}): T[] {
  const raw = runOutput.results ?? [];
  const out: T[] = [];
  for (const item of raw) {
    if (Array.isArray(item)) {
      for (const inner of item) {
        if (inner !== undefined) out.push(inner as T);
      }
    } else if (item !== undefined) {
      out.push(item as T);
    }
  }
  return out;
}
