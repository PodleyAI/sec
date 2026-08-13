/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ModelConfig } from "workglow";
import { getGlobalModelRepository, IExecuteContext, Task, Workflow } from "workglow";
import { sweepStepContext } from "../../eval/evalProgressContext";
import { preparedSectionText } from "../../eval/fixtures";
import { getGoldenLabels } from "../../eval/goldenS1Labels";
import { EvalS1CandidateTask } from "./EvalS1CandidateTask";
import { sectionModelConcurrencyLimit } from "./evalS1Concurrency";
import {
  checkpointEvalS1Results,
  collectMappedResults,
  GOLDEN_REFERENCE,
  REFERENCE_MAX_ATTEMPTS,
  runSection,
  type OracleRunResult,
} from "./evalS1Run";

const InputSchema = () =>
  Type.Object({
    filing: Type.String({ title: "Filing" }),
    extractor: Type.String({ title: "Extractor" }),
    text: Type.String({ title: "Section text" }),
    reference: Type.String({ title: "Reference id" }),
    dumpRaw: Type.Optional(Type.Boolean()),
    sectionModelConcurrency: Type.Optional(
      Type.Number({
        title: "Section model concurrency",
        description: "Candidate models in flight for this section",
        minimum: 1,
      })
    ),
  });

export type EvalS1SectionTaskInput = Static<ReturnType<typeof InputSchema>> & {
  readonly candidates: readonly string[];
};

const OutputSchema = () =>
  Type.Object({
    results: Type.Array(Type.Unknown()),
  });

export class EvalS1SectionTask extends Task<
  EvalS1SectionTaskInput,
  { results: OracleRunResult[] }
> {
  static readonly type = "EvalS1SectionTask";
  static readonly category = "SEC";
  static readonly title = "Evaluate S-1 section";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }
  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: EvalS1SectionTaskInput,
    context: IExecuteContext
  ): Promise<{ results: OracleRunResult[] }> {
    const dumpRaw = input.dumpRaw === true;
    const useGolden = input.reference === GOLDEN_REFERENCE;
    const section = { filing: input.filing, extractor: input.extractor, text: input.text };
    const promptLen = preparedSectionText(input.extractor, input.text).length;
    const tag = `${input.filing} ${input.extractor} (${(promptLen / 1000).toFixed(0)}k)`;
    const emit = (message: string): void => {
      if (!process.stdout.isTTY) process.stderr.write(`${message}\n`);
    };

    const refResults: OracleRunResult[] = [];
    let expected: readonly Record<string, unknown>[] = [];
    let refOk = false;

    if (useGolden) {
      const golden = getGoldenLabels(input.filing, input.extractor) ?? [];
      expected = golden as readonly Record<string, unknown>[];
      refOk = true;
      refResults.push({
        filing: input.filing,
        extractor: input.extractor,
        model: GOLDEN_REFERENCE,
        ok: true,
        error: undefined,
        latencyMs: 0,
        rows: golden.length,
        cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
        score: null,
        raw: undefined,
      });
      emit(`${tag} golden: ${golden.length} rows`);
    } else {
      const repo = getGlobalModelRepository();
      const refModel = (await repo.findByName(input.reference)) as ModelConfig | undefined;
      if (refModel) {
        const refStep = sweepStepContext(context, 0, `${tag} ref ${input.reference}`);
        let outcome = await runSection(input.reference, refModel, section, refStep, dumpRaw);
        for (let attempt = 1; !outcome.result.ok && attempt < REFERENCE_MAX_ATTEMPTS; attempt++) {
          outcome = await runSection(input.reference, refModel, section, refStep, dumpRaw);
        }
        expected = outcome.rows as Record<string, unknown>[];
        refOk = outcome.result.ok;
        refResults.push({ ...outcome.result, score: null });
        emit(
          `${tag} ref ${input.reference}: ${refOk ? "ok" : "FAIL"} ${outcome.result.latencyMs.toFixed(0)}ms ${outcome.result.rows} rows`
        );
      }
    }

    const n = input.candidates.length;
    if (n === 0) {
      checkpointEvalS1Results(refResults);
      return { results: refResults };
    }

    const wf = context.own(new Workflow(), {
      title: `Candidates for ${input.filing} ${input.extractor}`,
    });
    const loop = wf.map({
      // Named by its own flag rather than taken from the candidate count, which
      // is not a concurrency decision: it silently multiplied the sweep's
      // fan-out by however many models the operator listed.
      concurrencyLimit: sectionModelConcurrencyLimit(input.sectionModelConcurrency, n),
      maxIterations: n,
      preserveOrder: true,
      flatten: true,
    });
    loop.pipe(
      new EvalS1CandidateTask({
        defaults: {
          filing: input.filing,
          extractor: input.extractor,
          text: input.text,
          reference: input.reference,
          dumpRaw,
          refOk,
          expected,
        },
      })
    );
    loop.endMap();
    const mapped = await wf.run({ modelId: [...input.candidates] });
    const candidateRows = collectMappedResults<OracleRunResult>(mapped);
    const results = [...refResults, ...candidateRows];
    // Checkpointed here rather than collected only at the end: the section map
    // discards partial output on abort, and every row above cost an API call.
    checkpointEvalS1Results(results);
    return { results };
  }
}
