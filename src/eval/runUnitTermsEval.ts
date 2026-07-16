/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { getGlobalModelRepository } from "workglow";
import { ensureModelDownloaded } from "../config/ensureModelDownloaded";
import { registerModelIds } from "../config/registerModels";
import {
  cikFromFilingName,
  embarcExpectedRow,
  loadEmbarcUnitTermsReference,
} from "./embarcUnitTermsReference";
import { EVAL_EXTRACTORS } from "./fixtures";
import { estimateCost } from "./modelPricing";
import { loadRealS1Sections, type RealSection } from "./realSections";
import { scoreExtraction } from "./scoreExtraction";
import {
  summarizeModelRuns,
  type EvalReport,
  type FixtureRunResult,
} from "./runExtractionEval";
import { unloadLocalModel } from "./unloadModel";

/**
 * embarc-truth eval for the offering-terms extraction: instead of a reference
 * MODEL as oracle (`sec eval s1`) or synthetic golden fixtures (`sec eval
 * extract`), the truth is embarc's hand-curated unit structure
 * ({@link loadEmbarcUnitTermsReference}) — an independent, human dataset over
 * the same real prospectuses. Each candidate extracts "The Offering" section
 * of every committed S-1 whose CIK embarc covers, and is scored on the unit
 * price / warrant fraction / rights fraction embarc recorded.
 */
export interface RunUnitTermsOptions {
  readonly models: readonly string[];
  /** Directory of real S-1 HTML to segment (default: the committed mock_data dir). */
  readonly dir?: string;
  readonly onProgress?: (done: number, total: number, message: string) => void;
  readonly signal?: AbortSignal;
}

export interface UnitTermsReport extends EvalReport {
  /** Scored filings (embarc-covered, with a segmentable offering section). */
  readonly sections: number;
  /** Filings dropped and why (no embarc coverage / no offering section / parse failure). */
  readonly skipped: readonly string[];
}

const EXTRACTOR_NAME = "offering-terms";

/** The numeric fields scored against embarc; see {@link roundUnitFields}. */
const UNIT_FIELDS = [
  "price_per_unit",
  "warrant_fraction_per_unit",
  "right_fraction_per_unit",
] as const;

/**
 * Round the scored numeric fields to 2 decimals on BOTH sides before scoring:
 * `scoreExtraction` compares numbers by exact stringification, and repeating
 * fractions would otherwise never match (embarc's one-third is
 * 0.3333333333333333; a model may emit 0.33 or 0.3333). Two decimals keeps the
 * real fractions (1, 3/4, 1/2, 1/3, 1/4, …, 1/20) distinct.
 */
export function roundUnitFields(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const f of UNIT_FIELDS) {
    const v = out[f];
    if (typeof v === "number" && Number.isFinite(v)) out[f] = Math.round(v * 100) / 100;
  }
  return out;
}

interface CoveredSection {
  readonly section: RealSection;
  readonly expected: Record<string, unknown>;
}

function selectCovered(dir: string | undefined): {
  covered: CoveredSection[];
  skipped: string[];
} {
  const { sections, skipped } = loadRealS1Sections([EXTRACTOR_NAME], dir);
  const reference = loadEmbarcUnitTermsReference();
  const covered: CoveredSection[] = [];
  const allSkipped = [...skipped];
  for (const section of sections) {
    const cik = cikFromFilingName(section.filing);
    const ref = cik === null ? undefined : reference.get(cik);
    if (!ref) {
      allSkipped.push(`${section.filing}: no embarc unit-terms coverage`);
      continue;
    }
    const expected = roundUnitFields(embarcExpectedRow(ref));
    if (Object.keys(expected).length === 0) {
      allSkipped.push(`${section.filing}: embarc row carries no scorable fields`);
      continue;
    }
    covered.push({ section, expected });
  }
  return { covered, skipped: allSkipped };
}

/**
 * Sequential sweep (same rationale as {@link runExtractionEval}): every model
 * extracts every covered filing's offering section; a failed resolution or
 * extraction is a failed run, not an abort. Rankings reuse the extract-eval
 * summary shape so the CLI table renders identically.
 */
export async function runUnitTermsEval(opts: RunUnitTermsOptions): Promise<UnitTermsReport> {
  await registerModelIds(opts.models);
  const repo = getGlobalModelRepository();
  const { covered, skipped } = selectCovered(opts.dir);
  const extractor = EVAL_EXTRACTORS[EXTRACTOR_NAME];

  const results: FixtureRunResult[] = [];
  const summaries: UnitTermsReport["summaries"][number][] = [];
  const progress = opts.onProgress ?? ((): void => {});
  const total = opts.models.length * covered.length;
  let done = 0;

  for (const modelId of opts.models) {
    if (opts.signal?.aborted) break;
    const model = (await repo.findByName(modelId)) as ModelConfig | undefined;
    const provider = (model as { provider?: string } | undefined)?.provider ?? "unknown";
    // Prefetch a local model's weights before timing (see runExtractionEval).
    if (model) {
      try {
        await ensureModelDownloaded(model);
      } catch {
        // The per-section extraction call will re-attempt and record the failure.
      }
    }
    const modelRows: FixtureRunResult[] = [];
    for (const { section, expected } of covered) {
      if (opts.signal?.aborted) break;
      progress(done, total, `${modelId} — ${section.filing}`);
      const promptChars = section.text.length + extractor.instructionOverheadChars;
      const t0 = Bun.nanoseconds();
      let result: FixtureRunResult;
      try {
        if (!model) throw new Error(`model "${modelId}" not registered`);
        const rows = (await extractor.run(section.text, model)).map((r) =>
          roundUnitFields(r as Record<string, unknown>)
        );
        result = {
          model: modelId,
          fixture: section.filing,
          extractor: EXTRACTOR_NAME,
          ok: true,
          error: undefined,
          latencyMs: (Bun.nanoseconds() - t0) / 1e6,
          rows: rows.length,
          score: scoreExtraction(rows, [expected], {}),
          cost: estimateCost(modelId, promptChars, JSON.stringify(rows).length),
        };
      } catch (err) {
        result = {
          model: modelId,
          fixture: section.filing,
          extractor: EXTRACTOR_NAME,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          latencyMs: (Bun.nanoseconds() - t0) / 1e6,
          rows: 0,
          score: scoreExtraction([], [expected], {}),
          cost: estimateCost(modelId, promptChars, 0),
        };
      }
      results.push(result);
      modelRows.push(result);
      done += 1;
      progress(
        done,
        total,
        `${modelId} — ${section.filing} (score ${(result.score.score * 100).toFixed(0)}%)`
      );
    }
    summaries.push(summarizeModelRuns(modelId, provider, modelRows));
    if (model) await unloadLocalModel(model);
  }

  summaries.sort(
    (a, b) =>
      b.avgScore - a.avgScore ||
      (a.totalUsd ?? Infinity) - (b.totalUsd ?? Infinity) ||
      a.avgLatencyMs - b.avgLatencyMs
  );

  return { results, summaries, sections: covered.length, skipped };
}
