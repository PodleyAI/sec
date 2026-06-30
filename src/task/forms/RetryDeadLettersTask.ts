/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import {
  globalServiceRegistry,
  IExecuteContext,
  Task,
  TaskAbortedError,
  TaskError,
  Workflow,
} from "workglow";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

const InputSchema = () =>
  Type.Object({
    extractorId: Type.String({ title: "Extractor id", description: "e.g. 'S-1'" }),
    dryRun: Type.Optional(Type.Boolean({ default: false })),
  });
export type RetryDeadLettersTaskInput = Static<ReturnType<typeof InputSchema>>;

const OutputSchema = () =>
  Type.Object({
    eligibleAccessions: Type.Array(Type.String()),
    reprocessed: Type.Number(),
    failed: Type.Number(),
  });
type RetryDeadLettersTaskOutput = Static<ReturnType<typeof OutputSchema>>;

export class RetryDeadLettersTask extends Task<
  RetryDeadLettersTaskInput,
  RetryDeadLettersTaskOutput
> {
  static readonly type = "RetryDeadLettersTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }

  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: RetryDeadLettersTaskInput,
    context: IExecuteContext
  ): Promise<RetryDeadLettersTaskOutput> {
    const { extractorId } = input;
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    const slot = await getActiveSlot(reg, "extractor", extractorId);
    if (!slot) throw new TaskError(`No active slot for extractor '${extractorId}'`);

    const deadLetters = new ExtractionDeadLetterRepo();
    const eligible = await deadLetters.listEligible(extractorId, slot.semver);

    // Group by accession; per-section reconciliation happens inside processForm*.
    const accessions = [...new Set(eligible.map((e) => e.accession_number))];

    if (input.dryRun) {
      return { eligibleAccessions: accessions, reprocessed: 0, failed: 0 };
    }

    let reprocessed = 0;
    let failed = 0;
    for (const accessionNumber of accessions) {
      if (context.signal?.aborted) throw new TaskAbortedError();
      // Isolate each accession: ProcessAccessionDocFormTask rethrows hard
      // parse/store errors, and a recovery sweep must grind through the whole
      // worklist rather than abandon every later accession on one bad filing.
      try {
        const wf = context.own(new Workflow());
        wf.pipe(new ProcessAccessionDocFormTask());
        await wf.run({ accessionNumber });
        reprocessed++;
      } catch (e) {
        if (e instanceof TaskAbortedError) throw e;
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`retry-dead-letters: ${accessionNumber} failed to reprocess: ${message}`);
      }
    }
    return { eligibleAccessions: accessions, reprocessed, failed };
  }
}
