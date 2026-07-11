/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { IExecuteContext, Task } from "workglow";
import { runOracleEval } from "../../eval/runOracleEval";

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
 * Task wrapper around {@link runOracleEval} so `sec eval s1` runs under the CLI's
 * automatic task-graph progress UI (one step per model×section) and is abortable.
 * Large real S-1 sections take tens of seconds each on a local model, so live
 * progress matters here.
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
    const report = await runOracleEval({
      reference: input.reference,
      candidates: input.candidates,
      extractors: input.extractors,
      dir: input.dir,
      signal: context.signal,
      onProgress: (done, total, message) => {
        const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
        void context.updateProgress(pct, message);
      },
    });
    // The runner returns this verbatim (no output-schema stripping), so the CLI
    // casts back to the full `OracleReport`; the declared output only satisfies
    // DataPorts.
    return report as EvalS1TaskOutput;
  }
}
