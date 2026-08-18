/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { IExecuteContext, Task } from "workglow";
import { runUnderwritersEval } from "../../eval/runUnderwritersEval";

const InputSchema = () =>
  Type.Object({
    extractorId: Type.Optional(
      Type.String({ title: "Extractor id", description: "Limit to S-1 or 424" })
    ),
    limit: Type.Optional(Type.Number({ title: "Limit", description: "Max stored rows to score" })),
    cik: Type.Optional(Type.Number({ title: "CIK", description: "Limit to one issuer" })),
  });
export type EvalUnderwritersTaskInput = Static<ReturnType<typeof InputSchema>>;

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
export type EvalUnderwritersTaskOutput = Static<ReturnType<typeof OutputSchema>>;

/**
 * Scores the deterministic SPAC underwriter table parser against stored
 * syndicate rows using on-disk accession docs. Never fetches EDGAR.
 */
export class EvalUnderwritersTask extends Task<
  EvalUnderwritersTaskInput,
  EvalUnderwritersTaskOutput
> {
  static readonly type = "EvalUnderwritersTask";
  static readonly category = "SEC";
  static readonly title = "Evaluate underwriters";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }

  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: EvalUnderwritersTaskInput,
    context: IExecuteContext
  ): Promise<EvalUnderwritersTaskOutput> {
    const report = await runUnderwritersEval({
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
    return report as unknown as EvalUnderwritersTaskOutput;
  }
}
