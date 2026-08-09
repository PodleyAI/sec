/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { IExecuteContext, Task } from "workglow";
import { runExtractionEval } from "../../eval/runExtractionEval";

const InputSchema = () =>
  Type.Object({
    models: Type.Array(Type.String(), {
      title: "Model ids",
      description: "Candidate model ids to compare",
      minItems: 1,
    }),
    extractor: Type.Optional(
      Type.String({ title: "Extractor", description: "Limit to one extractor (e.g. 'management')" })
    ),
    fixtures: Type.Optional(
      Type.Array(Type.String(), {
        title: "Fixture names",
        description: "Limit to these fixtures by name (e.g. 's1-management-operating-company')",
      })
    ),
    real: Type.Optional(
      Type.Boolean({
        title: "Real sections",
        description: "Sweep the real committed S-1 sections instead of the curated fixtures",
      })
    ),
    runs: Type.Optional(
      Type.Number({
        title: "Runs per fixture",
        description:
          "Repeat each fixture this many times per model to measure reproducibility (default 1)",
        minimum: 1,
      })
    ),
    dumpRaw: Type.Optional(
      Type.Boolean({
        title: "Dump raw",
        description: "Retain model JSON payloads on each result for CLI --dump-raw",
      })
    ),
  });
export type EvalExtractTaskInput = Static<ReturnType<typeof InputSchema>>;

/**
 * Summary row per model — the ranking the CLI prints. `results` (the per-fixture
 * runs with their full {@link ExtractionScore} incl. diffs) is opaque to the
 * schema: the runner returns `execute`'s value verbatim, so the CLI still gets
 * the complete report to render.
 */
const OutputSchema = () =>
  Type.Object({
    results: Type.Array(Type.Unknown()),
    summaries: Type.Array(
      Type.Object({
        model: Type.String(),
        provider: Type.String(),
        runs: Type.Number(),
        okRuns: Type.Number(),
        avgScore: Type.Number(),
        avgEntityRecall: Type.Number(),
        avgPrecision: Type.Number(),
        avgLatencyMs: Type.Number(),
        totalUsd: Type.Union([Type.Number(), Type.Null()]),
      })
    ),
    stability: Type.Optional(Type.Array(Type.Unknown())),
  });
export type EvalExtractTaskOutput = Static<ReturnType<typeof OutputSchema>>;

/**
 * Task wrapper around {@link runExtractionEval} so `sec eval extract` runs under
 * the CLI's automatic task-graph progress UI (one step per model×fixture) and is
 * abortable, instead of running silent until the final table.
 */
export class EvalExtractTask extends Task<EvalExtractTaskInput, EvalExtractTaskOutput> {
  static readonly type = "EvalExtractTask";
  static readonly category = "SEC";
  static readonly title = "Compare extraction models";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }

  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: EvalExtractTaskInput,
    context: IExecuteContext
  ): Promise<EvalExtractTaskOutput> {
    const fixtures = input.fixtures?.filter((n) => typeof n === "string" && n.length > 0);
    const report = await runExtractionEval({
      models: input.models,
      extractor: input.extractor,
      ...(fixtures && fixtures.length > 0 ? { fixtures } : {}),
      runs: input.runs,
      real: input.real,
      dumpRaw: input.dumpRaw,
      signal: context.signal,
      context,
      onProgress: (done, total, message) => {
        const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
        void context.updateProgress(pct, message);
        // Mirror to stderr when piped (no TTY task UI), so a long sweep isn't
        // blind until the final table. stdout stays clean for table/JSON output.
        if (!process.stdout.isTTY) process.stderr.write(`${message}\n`);
      },
    });
    // The runner returns this verbatim (no output-schema stripping), so the CLI
    // casts back to the full `EvalReport`; the declared output only satisfies
    // DataPorts.
    return report as EvalExtractTaskOutput;
  }
}
