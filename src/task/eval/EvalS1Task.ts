/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ModelConfig, ModelEffort } from "workglow";
import { getGlobalModelRepository, IExecuteContext, isModelEffort, Task } from "workglow";
import { prefetchModel } from "../model/EnsureModelDownloadedTask";
import { registerModelIds } from "../../config/registerModels";
import { sweepStepContext } from "../../eval/evalProgressContext";
import { EVAL_EXTRACTORS, preparedSectionText } from "../../eval/fixtures";
import { getGoldenLabels, goldenLabelKey, GOLDEN_S1_LABELS } from "../../eval/goldenS1Labels";
import { estimateCost } from "../../eval/modelPricing";
import { loadRealS1Sections, type RealSection } from "../../eval/realSections";
import { scoreExtraction } from "../../eval/scoreExtraction";
import { setExtractionEffortOverride } from "../../sec/forms/registration-statements/s1/extractionReasoning";
import {
  GOLDEN_REFERENCE,
  REFERENCE_MAX_ATTEMPTS,
  runSection,
  summarize,
  type OracleModelSummary,
  type OracleReport,
  type OracleRunResult,
} from "./evalS1Run";

export {
  GOLDEN_REFERENCE,
  type OracleModelSummary,
  type OracleReport,
  type OracleRunResult,
};

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
    ciks: Type.Optional(
      Type.Array(Type.String(), {
        title: "CIKs",
        description: "Limit the sweep to fixtures filed by these CIKs",
      })
    ),
    dumpRaw: Type.Optional(
      Type.Boolean({
        title: "Dump raw",
        description: "Retain model JSON payloads on each result for CLI --dump-raw",
      })
    ),
    effort: Type.Optional(
      Type.String({
        title: "Effort override",
        description:
          "When set, replaces every extractor's baked-in model.effort for this sweep " +
          "(none|low|medium|high|extra|ultra)",
      })
    ),
    concurrency: Type.Optional(
      Type.Number({
        title: "Concurrency",
        description: "Max S-1 sections in flight (default 5)",
        minimum: 1,
      })
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
  static readonly title = "Evaluate S-1 extraction";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }

  static outputSchema() {
    return OutputSchema();
  }

  async execute(input: EvalS1TaskInput, context: IExecuteContext): Promise<EvalS1TaskOutput> {
    if (input.effort !== undefined) {
      if (!isModelEffort(input.effort)) {
        throw new Error(
          `invalid effort "${input.effort}"; expected one of: none, low, medium, high, extra, ultra`
        );
      }
      setExtractionEffortOverride(input.effort as ModelEffort);
    }
    try {
      return await this.runOracle(input, context);
    } finally {
      setExtractionEffortOverride(undefined);
    }
  }

  private async runOracle(
    input: EvalS1TaskInput,
    context: IExecuteContext
  ): Promise<EvalS1TaskOutput> {
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
    const dumpRaw = input.dumpRaw === true;
    // Golden mode runs no reference model — the truth is committed.
    await registerModelIds(
      useGolden ? [...input.candidates] : [input.reference, ...input.candidates]
    );
    const repo = getGlobalModelRepository();
    const loaded = loadRealS1Sections(extractorNames, input.dir, input.ciks);
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
      // The reverse check: a committed label whose fixture never arrived. A
      // downstream package vendors its own copy of the corpus, and when that
      // copy drifts the labelled filing simply produces no section — so the
      // sweep scored fewer filings than the labels cover and said nothing,
      // which reads exactly like a clean run. Report the gap; a `--cik` filter
      // is a deliberate narrowing, so it suppresses this.
      if (!input.ciks || input.ciks.length === 0) {
        const present = new Set(labeled.map((s) => goldenLabelKey(s.filing, s.extractor)));
        for (const extractor of extractorNames) {
          for (const key of Object.keys(GOLDEN_S1_LABELS)) {
            if (!key.endsWith(`::${extractor}`) || present.has(key)) continue;
            skipped.push(
              `${key.replace("::", " / ")}: golden label committed but no section found — ` +
                `is the fixture missing from the S-1 corpus in use?`
            );
          }
        }
      }
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
      await prefetchModel(id, context);
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
      const promptLen = preparedSectionText(section.extractor, section.text).length;
      const tag = `[${si + 1}/${sections.length}] ${section.filing} ${section.extractor} (${kchars(promptLen)})`;
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
          raw: undefined,
        });
        done += 1;
        emitProgress(done, total, `${tag} golden: ${golden.length} rows`);
      } else if (refModel) {
        const refStep = sweepStepContext(
          context,
          Math.floor((done / (total || 1)) * 100),
          `${tag} ref ${input.reference}`
        );
        let outcome = await runSection(input.reference, refModel, section, refStep, dumpRaw);
        for (let attempt = 1; !outcome.result.ok && attempt < REFERENCE_MAX_ATTEMPTS; attempt++) {
          outcome = await runSection(input.reference, refModel, section, refStep, dumpRaw);
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
            raw: dumpRaw ? { kind: "none" } : undefined,
          });
          done += 1;
          continue;
        }
        const { rows, result } = await runSection(
          candidateId,
          candModel,
          section,
          sweepStepContext(
            context,
            Math.floor((done / (total || 1)) * 100),
            `${tag} ${candidateId}`
          ),
          dumpRaw
        );
        // Only score when the reference produced a usable truth for this section.
        const score = refOk
          ? scoreExtraction(rows, expected, {
              keyField: extractor.keyField,
              fields: extractor.compareFields,
              personNameFields: extractor.personNameFields,
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
          : (((await repo.findByName(modelId)) as { provider?: string } | undefined)?.provider ??
            "unknown");
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
