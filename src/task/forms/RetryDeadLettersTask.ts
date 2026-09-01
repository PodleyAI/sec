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
} from "workglow";
import {
  ExtractionDeadLetterRepo,
  isExpectedNegativeDeadLetter,
} from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { extractorIsSuppliedElsewhere } from "../../sec/forms/parserOnlyForms";
import { getBackfillDescriptor } from "./backfillDescriptors";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

const InputSchema = () =>
  Type.Object({
    extractorId: Type.String({ title: "Extractor id", description: "e.g. 'S-1-xbrl'" }),
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

    // `db setup` seeds a slot for every id the CLI knows, which includes the
    // readings a consumer package ships. Without this the slot resolves, the
    // dead letters list, and each filing reaches a dispatch that runs some OTHER
    // extractor of the same form — recording ITS run and resolving ITS
    // filing-level entry, never this id's. Every entry counts as reprocessed,
    // none resolves, and the same set is re-selected on every later run.
    //
    // The test is the one `extractor backfill` applies: an id nothing in this
    // deployment can re-run has no descriptor either, because a descriptor is
    // resolved from the registered forms or contributed by the package that
    // ships the reading. `extractorIsSuppliedElsewhere` is asked first only
    // because it is the more specific diagnosis.
    if (extractorIsSuppliedElsewhere(extractorId)) {
      throw new TaskError(
        `Cannot retry dead letters for '${extractorId}': this deployment registers no extractor ` +
          `under that id. Its forms are parsed here and read by a consumer package — run the ` +
          `retry under that package, or name an extractor this one ships.`
      );
    }
    if (getBackfillDescriptor(extractorId) === undefined) {
      throw new TaskError(
        `Cannot retry dead letters for '${extractorId}': this deployment registers no extractor ` +
          `and no backfill wiring under that id, so a retry would dispatch filings that resolve ` +
          `nothing and re-select the same entries on every run. Run it under the package that ` +
          `ships that reading, or name an extractor this one has.`
      );
    }

    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    const slot = await getActiveSlot(reg, "extractor", extractorId);
    if (!slot) throw new TaskError(`No active slot for extractor '${extractorId}'`);

    const deadLetters = new ExtractionDeadLetterRepo();
    const eligible = await deadLetters.listEligible(extractorId, slot.semver);

    // Group by accession; per-section reconciliation happens inside processForm*.
    const accessions = [...new Set(eligible.map((e) => e.accession_number))];
    const expectedNegativeOnly = new Set(
      accessions.filter((accession) =>
        eligible.filter((e) => e.accession_number === accession).every(isExpectedNegativeDeadLetter)
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
      // type, no active slot), and a recovery sweep must grind through the
      // whole worklist rather than abandon every later accession on one bad
      // filing. A form nothing in this deployment reads is not among those —
      // that one is skipped with a warning and returns.
      try {
        const ft = context.own(
          new ProcessAccessionDocFormTask({ title: `Reprocess ${accessionNumber}` })
        );
        try {
          await ft.run({ accessionNumber });
        } finally {
          context.disown(ft);
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
