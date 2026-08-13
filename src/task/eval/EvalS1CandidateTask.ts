/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ModelConfig } from "workglow";
import { getGlobalModelRepository, IExecuteContext, Task } from "workglow";
import { sweepStepContext } from "../../eval/evalProgressContext";
import { EVAL_EXTRACTORS } from "../../eval/fixtures";
import { estimateCost } from "../../eval/modelPricing";
import { scoreExtraction } from "../../eval/scoreExtraction";
import { runSection, type OracleRunResult } from "./evalS1Run";

const InputSchema = () =>
  Type.Object({
    modelId: Type.String({ title: "Candidate model id" }),
    filing: Type.String({ title: "Filing" }),
    extractor: Type.String({ title: "Extractor" }),
    text: Type.String({ title: "Section text" }),
    reference: Type.String({ title: "Reference id" }),
    refOk: Type.Boolean({ title: "Reference succeeded" }),
    dumpRaw: Type.Optional(Type.Boolean()),
  });

export type EvalS1CandidateTaskInput = Static<ReturnType<typeof InputSchema>> & {
  readonly expected: readonly Record<string, unknown>[];
};

const OutputSchema = () =>
  Type.Object({
    results: Type.Array(Type.Unknown()),
  });

export class EvalS1CandidateTask extends Task<
  EvalS1CandidateTaskInput,
  { results: OracleRunResult[] }
> {
  static readonly type = "EvalS1CandidateTask";
  static readonly category = "SEC";
  static readonly title = "Evaluate S-1 candidate";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }
  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: EvalS1CandidateTaskInput,
    context: IExecuteContext
  ): Promise<{ results: OracleRunResult[] }> {
    const dumpRaw = input.dumpRaw === true;
    const section = { filing: input.filing, extractor: input.extractor, text: input.text };
    const tag = `${input.filing} ${input.extractor}`;
    const candModel = (await getGlobalModelRepository().findByName(input.modelId)) as
      | ModelConfig
      | undefined;
    if (!candModel) {
      const result: OracleRunResult = {
        filing: input.filing,
        extractor: input.extractor,
        model: input.modelId,
        ok: false,
        error: `model "${input.modelId}" not registered`,
        latencyMs: 0,
        rows: 0,
        cost: estimateCost(input.modelId, 0, 0),
        score: null,
        raw: dumpRaw ? { kind: "none" } : undefined,
      };
      return { results: [result] };
    }
    const step = sweepStepContext(context, 0, `${tag} ${input.modelId}`);
    const { rows, result } = await runSection(input.modelId, candModel, section, step, dumpRaw);
    const extractor = EVAL_EXTRACTORS[input.extractor];
    const score =
      input.refOk && extractor
        ? scoreExtraction(rows, input.expected as Record<string, unknown>[], {
            keyField: extractor.keyField,
            fields: extractor.compareFields,
            personNameFields: extractor.personNameFields,
            companyNameFields: extractor.companyNameFields,
            entityNameFields: extractor.entityNameFields,
            entityKindField: extractor.entityKindField,
          })
        : null;
    const scored: OracleRunResult = { ...result, score };
    if (!process.stdout.isTTY) {
      const agree = score ? ` agree ${(score.score * 100).toFixed(0)}%` : "";
      process.stderr.write(
        `${tag} cand ${input.modelId}: ${scored.ok ? "ok" : "FAIL"} ${scored.latencyMs.toFixed(0)}ms ${scored.rows} rows${agree}\n`
      );
    }
    return { results: [scored] };
  }
}
