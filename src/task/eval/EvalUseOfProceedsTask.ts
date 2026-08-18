/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { IExecuteContext, Task } from "workglow";
import { runUseOfProceedsEval } from "../../eval/runUseOfProceedsEval";

const InputSchema = () =>
  Type.Object({
    extractorId: Type.Optional(
      Type.String({ title: "Extractor id", description: "Limit to S-1 or 424" })
    ),
    limit: Type.Optional(Type.Number({ title: "Limit", description: "Max stored rows to score" })),
    cik: Type.Optional(Type.Number({ title: "CIK", description: "Limit to one issuer" })),
  });
export type EvalUseOfProceedsTaskInput = Static<ReturnType<typeof InputSchema>>;

const OutputSchema = () =>
  Type.Object({
    cases: Type.Array(Type.Unknown()),
    counts: Type.Object({
      "hit-agree": Type.Number(),
      "hit-disagree": Type.Number(),
      miss: Type.Number(),
      empty: Type.Number(),
      skip: Type.Number(),
    }),
  });
export type EvalUseOfProceedsTaskOutput = Static<ReturnType<typeof OutputSchema>>;

/**
 * Scores the deterministic SPAC use-of-proceeds table parser against stored
 * lines using on-disk accession docs. Never fetches EDGAR.
 */
export class EvalUseOfProceedsTask extends Task<
  EvalUseOfProceedsTaskInput,
  EvalUseOfProceedsTaskOutput
> {
  static readonly type = "EvalUseOfProceedsTask";
  static readonly category = "SEC";
  static readonly title = "Evaluate use of proceeds";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }

  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: EvalUseOfProceedsTaskInput,
    context: IExecuteContext
  ): Promise<EvalUseOfProceedsTaskOutput> {
    const report = await runUseOfProceedsEval({
      extractorId:
        input.extractorId === "424" || input.extractorId === "S-1" ? input.extractorId : undefined,
      limit: input.limit,
      cik: input.cik,
      signal: context.signal,
      onProgress: (done, total, message) => {
        const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
        void context.updateProgress(pct, message);
        if (!process.stdout.isTTY) process.stderr.write(`${message}\n`);
      },
    });
    return report as unknown as EvalUseOfProceedsTaskOutput;
  }
}
