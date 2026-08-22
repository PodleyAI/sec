/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { IExecuteContext, Task } from "workglow";
import { runManagementEval } from "../../eval/runManagementEval";

const InputSchema = () =>
  Type.Object({
    extractorId: Type.Optional(
      Type.String({ title: "Extractor id", description: "Limit to S-1 or 424" })
    ),
    limit: Type.Optional(Type.Number({ title: "Limit", description: "Max stored rows to score" })),
    cik: Type.Optional(Type.Number({ title: "CIK", description: "Limit to one issuer" })),
  });
export type EvalManagementTaskInput = Static<ReturnType<typeof InputSchema>>;

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
export type EvalManagementTaskOutput = Static<ReturnType<typeof OutputSchema>>;

/**
 * Scores the deterministic management roster parser against stored rows
 * using on-disk accession docs. Never fetches EDGAR.
 */
export class EvalManagementTask extends Task<EvalManagementTaskInput, EvalManagementTaskOutput> {
  static readonly type = "EvalManagementTask";
  static readonly category = "SEC";
  static readonly title = "Evaluate management";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }

  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: EvalManagementTaskInput,
    context: IExecuteContext
  ): Promise<EvalManagementTaskOutput> {
    const report = await runManagementEval({
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
    return report as unknown as EvalManagementTaskOutput;
  }
}
