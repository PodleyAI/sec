/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { IExecuteContext, Task } from "workglow";
import { runUnitTermsEval } from "../../eval/runUnitTermsEval";

const InputSchema = () =>
  Type.Object({
    models: Type.Array(Type.String(), {
      title: "Candidate models",
      description: "Models scored against embarc's curated unit terms",
      minItems: 1,
    }),
    dir: Type.Optional(
      Type.String({ title: "S-1 dir", description: "Directory of real S-1 HTML to segment" })
    ),
  });
export type EvalUnitTermsTaskInput = Static<ReturnType<typeof InputSchema>>;

const OutputSchema = () =>
  Type.Object({
    sections: Type.Number(),
    skipped: Type.Array(Type.String()),
    results: Type.Array(Type.Unknown()),
    summaries: Type.Array(Type.Unknown()),
  });
export type EvalUnitTermsTaskOutput = Static<ReturnType<typeof OutputSchema>>;

/**
 * Task wrapper around {@link runUnitTermsEval} so `sec eval unit-terms` runs
 * under the CLI's task-graph progress UI and is abortable — the truth here is
 * embarc's hand-curated unit structure, not a reference model.
 */
export class EvalUnitTermsTask extends Task<EvalUnitTermsTaskInput, EvalUnitTermsTaskOutput> {
  static readonly type = "EvalUnitTermsTask";
  static readonly category = "SEC";
  static readonly title = "Evaluate SPAC unit terms";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }

  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: EvalUnitTermsTaskInput,
    context: IExecuteContext
  ): Promise<EvalUnitTermsTaskOutput> {
    const report = await runUnitTermsEval({
      models: input.models,
      dir: input.dir,
      signal: context.signal,
      context,
      onProgress: (done, total, message) => {
        const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
        void context.updateProgress(pct, message);
        if (!process.stdout.isTTY) process.stderr.write(`${message}\n`);
      },
    });
    return report as unknown as EvalUnitTermsTaskOutput;
  }
}
