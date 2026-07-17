/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ModelConfig } from "workglow";
import { getGlobalModelRepository, IExecuteContext, Task } from "workglow";
import { prefetchModel } from "../../config/ensureModelDownloaded";
import { registerModelIds } from "../../config/registerModels";
import { EVAL_EXTRACTORS } from "../../eval/fixtures";
import { getGoldenLabels } from "../../eval/goldenS1Labels";
import { estimateCost, type CostEstimate } from "../../eval/modelPricing";
import { loadRealS1Sections, type RealSection } from "../../eval/realSections";
import { scoreExtraction, type ExtractionScore } from "../../eval/scoreExtraction";

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

const InputSchema = () =>
  Type.Object({
    reference: Type.String({
      title: "Reference model",
      description: "Oracle model whose extraction is treated as truth",
    }),
    candidates: Type.Array(Type.String(), {
      title: "Candidate models",
      description: "Models scored on agreement with the reference",
      minItems: 1,
    }),
    extractors: Type.Array(Type.String(), {
      title: "Extractors",
      description: "Section extractors to pull (e.g. management)",
      minItems: 1,
    }),
    dir: Type.Optional(
      Type.String({ title: "S-1 dir", description: "Directory of real S-1 HTML to segment" })
    ),
  });
export type EvalS1TaskInput = Static<ReturnType<typeof InputSchema>>;

/**
 * `results` (per-section runs with their {@link ExtractionScore} diffs) is opaque
 * to the schema; the runner returns `execute`'s value verbatim, so the CLI gets
 * the full report to render.
 */
const OutputSchema = () =>
  Type.Object({
    reference: Type.String(),
    sections: Type.Number(),
    skipped: Type.Array(Type.String()),
    results: Type.Array(Type.Unknown()),
    summaries: Type.Array(Type.Unknown()),
  });
export type EvalS1TaskOutput = Static<ReturnType<typeof OutputSchema>>;

/**
 * Oracle comparison over **real committed S-1 sections**: the `reference` model
 * (e.g. sonnet-5) extracts each section to establish the "truth", then every
 * `candidate` extracts the same section and is scored on how closely it agrees
 * with the reference (field agreement, entity recall, precision). This answers
 * "can a cheap/local model stand in for sonnet on real filings?" without hand-
 * labeling every section. Runs sequentially (models share a local HFT worker and
 * cloud limits). A section the reference itself fails on is not scored.
 *
 * Running as a task (rather than a bare function) puts the sweep under the CLI's
 * automatic task-graph progress UI (one step per model×section) and makes it
 * abortable — large real S-1 sections take tens of seconds each on a local
 * model, so live progress matters here.
 */
export class EvalS1Task extends Task<EvalS1TaskInput, EvalS1TaskOutput> {
  static readonly type = "EvalS1Task";
  static readonly category = "SEC";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }

  static outputSchema() {
    return OutputSchema();
  }

  async execute(input: EvalS1TaskInput, context: IExecuteContext): Promise<EvalS1TaskOutput> {
    // On a TTY, `withCli` renders the task-graph UI from `updateProgress`; when
    // piped (background / `--format json`), that UI is suppressed, so mirror
    // progress to stderr so a long local-model run isn't blind. stdout stays
    // clean for the report.
    const emitProgress = (done: number, total: number, message: string): void => {
      const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
      void context.updateProgress(pct, message);
      if (!process.stdout.isTTY) process.stderr.write(`${message}\n`);
    };

    const extractorNames = input.extractors.length ? input.extractors : ["management"];
    const useGolden = input.reference === GOLDEN_REFERENCE;
    // Golden mode runs no reference model — the truth is committed.
    await registerModelIds(useGolden ? [...input.candidates] : [input.reference, ...input.candidates]);
    const repo = getGlobalModelRepository();
    const loaded = loadRealS1Sections(extractorNames, input.dir);
    const skipped = [...loaded.skipped];
    // Under golden truth, score only sections we have hand-verified labels for.
    let sections = loaded.sections;
    if (useGolden) {
      const labeled: RealSection[] = [];
      for (const s of sections) {
        if (getGoldenLabels(s.filing, s.extractor)) labeled.push(s);
        else skipped.push(`${s.filing} / ${s.extractor}: no golden label`);
      }
      sections = labeled;
    }

    const refModel = useGolden
      ? undefined
      : ((await repo.findByName(input.reference)) as ModelConfig | undefined);
    // Prefetch every participating local model's weights before the timed section
    // loop so download time is not charged to a section's latency. Best-effort and
    // memoized; cloud models no-op. Candidates are resolved per-section below, so
    // fetch them here once up front. A failed download surfaces per-section. The
    // download runs through our real context, so its progress renders in the CLI
    // task UI and it is owned by this task's graph.
    for (const id of [...(refModel ? [input.reference] : []), ...input.candidates]) {
      const m = (await repo.findByName(id)) as ModelConfig | undefined;
      await prefetchModel(m, context);
    }
    const results: OracleRunResult[] = [];
    const perModel = new Map<string, OracleRunResult[]>();
    const push = (r: OracleRunResult): void => {
      results.push(r);
      (perModel.get(r.model) ?? perModel.set(r.model, []).get(r.model)!).push(r);
    };
    const kchars = (n: number): string => `${(n / 1000).toFixed(0)}k`;
    // One step per model run: the reference (a model run, or the golden lookup)
    // plus every candidate.
    const hasReference = refModel !== undefined || useGolden;
    const total = sections.length * ((hasReference ? 1 : 0) + input.candidates.length);
    let done = 0;

    const refLabel = useGolden ? "golden truth" : "1 reference";
    emitProgress(
      done,
      total,
      `oracle: ${sections.length} section(s) × (${refLabel} + ${input.candidates.length} candidate(s))`
    );
    for (let si = 0; si < sections.length; si++) {
      if (context.signal?.aborted) break;
      const section = sections[si];
      const tag = `[${si + 1}/${sections.length}] ${section.filing} ${section.extractor} (${kchars(section.text.length)})`;
      // Reference establishes truth for this section. Retry on failure: strong
      // models intermittently emit a nested array as a JSON *string* (which the
      // strict schema rejects), so a couple of retries recover most sections
      // rather than dropping them from the comparison.
      let refRows: unknown[] = [];
      let refOk = false;
      if (useGolden) {
        // Committed human-verified truth — no model call, no cost.
        const golden = getGoldenLabels(section.filing, section.extractor) ?? [];
        refRows = golden as unknown[];
        refOk = true;
        push({
          filing: section.filing,
          extractor: section.extractor,
          model: GOLDEN_REFERENCE,
          ok: true,
          error: undefined,
          latencyMs: 0,
          rows: golden.length,
          cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
          score: null,
        });
        done += 1;
        emitProgress(done, total, `${tag} golden: ${golden.length} rows`);
      } else if (refModel) {
        let outcome = await runSection(input.reference, refModel, section);
        for (let attempt = 1; !outcome.result.ok && attempt < REFERENCE_MAX_ATTEMPTS; attempt++) {
          outcome = await runSection(input.reference, refModel, section);
        }
        refRows = outcome.rows;
        refOk = outcome.result.ok;
        push({ ...outcome.result, score: null });
        done += 1;
        emitProgress(
          done,
          total,
          `${tag} ref ${input.reference}: ${refOk ? "ok" : "FAIL"} ${outcome.result.latencyMs.toFixed(0)}ms ${outcome.result.rows} rows`
        );
      }
      const extractor = EVAL_EXTRACTORS[section.extractor];
      const expected = refRows as Record<string, unknown>[];
      for (const candidateId of input.candidates) {
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
        emitProgress(
          done,
          total,
          `${tag} cand ${candidateId}: ${result.ok ? "ok" : "FAIL"} ${result.latencyMs.toFixed(0)}ms ${result.rows} rows${agree}`
        );
      }
    }

    const summaries: OracleModelSummary[] = [];
    for (const [modelId, rows] of perModel) {
      const role = modelId === input.reference ? "reference" : "candidate";
      const provider =
        modelId === GOLDEN_REFERENCE
          ? "golden"
          : ((await repo.findByName(modelId)) as { provider?: string } | undefined)?.provider ??
            "unknown";
      summaries.push(summarize(modelId, provider, role, rows));
    }
    // Reference first, then candidates ranked by agreement desc.
    summaries.sort((a, b) => {
      if (a.role !== b.role) return a.role === "reference" ? -1 : 1;
      return b.avgAgreement - a.avgAgreement || a.avgLatencyMs - b.avgLatencyMs;
    });

    // The runner returns this verbatim (no output-schema stripping), so the CLI
    // casts back to the full `OracleReport`; the declared output only satisfies
    // DataPorts.
    return {
      reference: input.reference,
      sections: sections.length,
      skipped,
      results,
      summaries,
    } as EvalS1TaskOutput;
  }
}
