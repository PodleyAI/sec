/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ModelConfig, ModelEffort } from "workglow";
import {
  getGlobalModelRepository,
  IExecuteContext,
  isModelEffort,
  Task,
  TaskAbortedError,
  Workflow,
} from "workglow";
import { prefetchModel } from "../model/EnsureModelDownloadedTask";
import { registerModelIds } from "../../config/registerModels";
import { getGoldenLabels, goldenLabelKey, GOLDEN_S1_LABELS } from "../../eval/goldenS1Labels";
import { loadRealS1Sections, type RealSection } from "../../eval/realSections";
import { setExtractionEffortOverride } from "../../sec/forms/registration-statements/s1/extractionReasoning";
import {
  effectiveEvalS1Concurrency,
  resolveEvalS1Concurrencies,
  type EvalS1Concurrency,
} from "./evalS1Concurrency";
import { EvalS1FilingTask } from "./EvalS1FilingTask";
import {
  beginEvalS1Sweep,
  collectMappedResults,
  drainEvalS1Sweep,
  GOLDEN_REFERENCE,
  groupSectionsByFiling,
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
    concurrencyS1: Type.Optional(
      Type.Number({ title: "S-1 concurrency", description: "Filings in flight", minimum: 1 })
    ),
    concurrencySection: Type.Optional(
      Type.Number({
        title: "Section concurrency",
        description: "Sections of one filing in flight",
        minimum: 1,
      })
    ),
    concurrencySectionModel: Type.Optional(
      Type.Number({
        title: "Section model concurrency",
        description: "Candidate models in flight per section",
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
    /** The three fan-out axes as REQUESTED — an upper bound, not a measurement. */
    concurrency: Type.Object({
      s1: Type.Number(),
      section: Type.Number(),
      sectionModel: Type.Number(),
    }),
    /** The three axes the sweep could actually reach — what the latencies were measured under. */
    effectiveConcurrency: Type.Object({
      s1: Type.Number(),
      section: Type.Number(),
      sectionModel: Type.Number(),
    }),
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
 * labeling every section. Three nested MapTasks fan the sweep out — filings,
 * then that filing's sections, then the candidates scoring one section — each
 * bounded by its own flag, so the extractions in flight is at most their product
 * (default 1 x 5 x 4) — each axis is separately capped by the work available to
 * it, which is what `effectiveConcurrency` on the output reports. A section the
 * reference itself fails on is not scored.
 *
 * Running as a task (rather than a bare function) puts the sweep under the CLI's
 * automatic task-graph progress UI and makes it abortable — large real S-1
 * sections take tens of seconds each on a local model, so live progress matters
 * here.
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

    const concurrency: EvalS1Concurrency = resolveEvalS1Concurrencies({
      s1: input.concurrencyS1,
      section: input.concurrencySection,
      sectionModel: input.concurrencySectionModel,
    });

    const results: OracleRunResult[] = [];
    beginEvalS1Sweep();
    const filings = groupSectionsByFiling(sections);
    // First point at which every axis's real bound is known. Reported alongside
    // the request rather than replacing it: the request is what the operator
    // typed, and quietly redefining a field's meaning is the same class of
    // mistake as reporting the request as though it were the measurement.
    const effectiveConcurrency = effectiveEvalS1Concurrency(concurrency, {
      filings: filings.length,
      maxSectionsPerFiling: filings.reduce((n, f) => Math.max(n, f.sections.length), 0),
      candidates: input.candidates.length,
    });
    if (filings.length > 0) {
      const wf = context.own(new Workflow(), {
        title: `Evaluate ${sections.length} S-1 sections across ${filings.length} filing(s)`,
      });
      const loop = wf.map({
        concurrencyLimit: Math.min(concurrency.s1, filings.length),
        maxIterations: filings.length,
        preserveOrder: true,
        flatten: true,
      });
      loop.pipe(
        new EvalS1FilingTask({
          defaults: {
            reference: input.reference,
            candidates: input.candidates,
            dumpRaw,
            sectionConcurrency: concurrency.section,
            sectionModelConcurrency: concurrency.sectionModel,
          },
        })
      );
      loop.endMap();
      try {
        const mapped = await wf.run({
          filing: filings.map((f) => f.filing),
          extractors: filings.map((f) => f.sections.map((s) => s.extractor)),
          texts: filings.map((f) => f.sections.map((s) => s.text)),
        });
        results.push(...collectMappedResults<OracleRunResult>(mapped));
        drainEvalS1Sweep();
      } catch (e) {
        if (!(e instanceof TaskAbortedError)) throw e;
        // The map discards a run's partial output on abort, but every completed
        // section already cost real API calls. Report what was paid for, and
        // say on the existing `skipped` channel that the sweep is incomplete —
        // a truncated table read as a finished one is worse than no table.
        const partial = drainEvalS1Sweep();
        results.push(...partial);
        const done = new Set(partial.map((r) => `${r.filing}::${r.extractor}`)).size;
        skipped.push(
          `interrupted after ${done} of ${sections.length} section(s) — the table below is ` +
            `partial and its averages cover only what finished`
        );
      }
    }

    const perModel = new Map<string, OracleRunResult[]>();
    for (const r of results) {
      (perModel.get(r.model) ?? perModel.set(r.model, []).get(r.model)!).push(r);
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
      concurrency,
      effectiveConcurrency,
      skipped,
      results,
      summaries,
    } as EvalS1TaskOutput;
  }
}
