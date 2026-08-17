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
import {
  ExtractionDeadLetterRepo,
  isExpectedNegativeDeadLetter,
} from "../../storage/dead-letter/ExtractionDeadLetterRepo";
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
    /**
     * Accessions cleared WITHOUT re-running the filing — every eligible entry
     * on them was an expected negative. Counted apart from `reprocessed`, which
     * claims a filing was actually put back through the pipeline.
     */
    resolved: Type.Number(),
    failed: Type.Number(),
  });
type RetryDeadLettersTaskOutput = Static<ReturnType<typeof OutputSchema>>;

export class RetryDeadLettersTask extends Task<
  RetryDeadLettersTaskInput,
  RetryDeadLettersTaskOutput
> {
  static readonly type = "RetryDeadLettersTask";
  static readonly category = "SEC";
  static readonly title = "Retry dead letters";
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
    const expectedNegativeOnly = new Set(
      accessions.filter((accession) =>
        eligible
          .filter((e) => e.accession_number === accession)
          .every(isExpectedNegativeDeadLetter)
      )
    );

    if (input.dryRun) {
      return { eligibleAccessions: accessions, reprocessed: 0, resolved: 0, failed: 0 };
    }

    let reprocessed = 0;
    let resolved = 0;
    let failed = 0;
    for (const accessionNumber of accessions) {
      if (context.signal?.aborted) throw new TaskAbortedError();
      if (expectedNegativeOnly.has(accessionNumber)) {
        for (const row of eligible.filter((e) => e.accession_number === accessionNumber)) {
          await deadLetters.markResolved(row.extractor_id, row.accession_number, row.section_name);
        }
        resolved++;
        continue;
      }
      // Isolate each accession: ProcessAccessionDocFormTask still throws for
      // failures it cannot attribute to a filing (unknown accession, no form
      // type, no registered extractor or active slot), and a recovery sweep
      // must grind through the whole worklist rather than abandon every later
      // accession on one bad filing.
      try {
        const wf = context.own(new Workflow(), { title: `Reprocess ${accessionNumber}` });
        wf.pipe(new ProcessAccessionDocFormTask());
        try {
          await wf.run({ accessionNumber });
        } finally {
          // `own` is add-only and the subgraph is cleared only between runs of
          // THIS task, which does not return until the whole worklist is done —
          // so without releasing each accession's wrapper the sweep retains one
          // per accession, with whatever each one accumulated. Nested rather
          // than hoisted out of the outer try so a throw from `own` itself
          // still counts as one failure instead of abandoning the sweep.
          context.disown(wf);
        }
        reprocessed++;
      } catch (e) {
        if (e instanceof TaskAbortedError) throw e;
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`retry-dead-letters: ${accessionNumber} failed to reprocess: ${message}`);
      }
    }
    return { eligibleAccessions: accessions, reprocessed, resolved, failed };
  }
}
