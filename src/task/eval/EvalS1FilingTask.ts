/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { IExecuteContext, Task, Workflow } from "workglow";
import { EvalS1SectionTask } from "./EvalS1SectionTask";
import { collectMappedResults, type OracleRunResult } from "./evalS1Run";

const InputSchema = () =>
  Type.Object({
    filing: Type.String({ title: "Filing" }),
    extractors: Type.Array(Type.String(), { title: "Extractors", minItems: 1 }),
    texts: Type.Array(Type.String(), { title: "Section texts", minItems: 1 }),
    reference: Type.String({ title: "Reference id" }),
    dumpRaw: Type.Optional(Type.Boolean()),
    sectionConcurrency: Type.Optional(
      Type.Number({
        title: "Section concurrency",
        description: "Sections of this filing in flight",
        minimum: 1,
      })
    ),
    sectionModelConcurrency: Type.Optional(
      Type.Number({
        title: "Section model concurrency",
        description: "Candidate models in flight per section",
        minimum: 1,
      })
    ),
  });

export type EvalS1FilingTaskInput = Static<ReturnType<typeof InputSchema>> & {
  readonly candidates: readonly string[];
};

const OutputSchema = () =>
  Type.Object({
    results: Type.Array(Type.Unknown()),
  });

/**
 * One filing's sections, mapped at the sweep's section concurrency.
 *
 * The filing is a layer of its own so `--concurrency-s1` has something to bound:
 * a flat section list gives an interrupted sweep a scatter of half-covered
 * filings, whereas finishing a filing before starting the next means Ctrl-C
 * leaves whole filings behind.
 */
export class EvalS1FilingTask extends Task<EvalS1FilingTaskInput, { results: OracleRunResult[] }> {
  static readonly type = "EvalS1FilingTask";
  static readonly category = "SEC";
  static readonly title = "Evaluate S-1 filing";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }
  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: EvalS1FilingTaskInput,
    context: IExecuteContext
  ): Promise<{ results: OracleRunResult[] }> {
    const count = Math.min(input.extractors.length, input.texts.length);
    if (count === 0) return { results: [] };

    const wf = context.own(new Workflow(), {
      title: `${input.filing}: ${count} section(s)`,
    });
    const loop = wf.map({
      concurrencyLimit: Math.max(1, Math.min(input.sectionConcurrency ?? count, count)),
      maxIterations: count,
      preserveOrder: true,
      flatten: true,
    });
    loop.pipe(
      new EvalS1SectionTask({
        defaults: {
          filing: input.filing,
          reference: input.reference,
          candidates: input.candidates,
          dumpRaw: input.dumpRaw === true,
          ...(input.sectionModelConcurrency !== undefined
            ? { sectionModelConcurrency: input.sectionModelConcurrency }
            : {}),
        },
      })
    );
    loop.endMap();
    const mapped = await wf.run({
      extractor: input.extractors.slice(0, count),
      text: input.texts.slice(0, count),
    });
    return { results: collectMappedResults<OracleRunResult>(mapped) };
  }
}
