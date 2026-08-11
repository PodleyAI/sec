/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, TaskError, Workflow } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { type Filing, FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { formToExtractorId } from "../../storage/versioning/extractorIds";
import { stripXslPrefix } from "../../util/accessionDocPath";
import { ProcessAccessionDocFormTask } from "../forms/ProcessAccessionDocFormTask";

const InputSchema = () =>
  Type.Object({
    cik: TypeSecCik(),
  });

export type ProcessSpacTimelineTaskInput = Static<ReturnType<typeof InputSchema>>;

const OutputSchema = () =>
  Type.Object({
    matched: Type.Number({ title: "Matched", description: "Filings on the issuer's timeline." }),
    processed: Type.Number({ title: "Processed", description: "Filings actually run." }),
    firstDate: Type.String({ title: "First", description: "Earliest filing_date processed." }),
    lastDate: Type.String({ title: "Last", description: "Latest filing_date processed." }),
  });

export type ProcessSpacTimelineTaskOutput = Static<ReturnType<typeof OutputSchema>>;

/**
 * Processes ONE issuer's filings in filing-date order, strictly serially.
 *
 * The unit of ordering for a SPAC is the issuer's timeline, not the form type.
 * Processing by form — all 424s, then all 8-Ks, then the proxies — walks the
 * same issuer's history backwards and forwards repeatedly, and three separate
 * things break when it does:
 *
 *  1. `Form_8_K.storage` records de-SPAC milestones ONLY when a SPAC row already
 *     exists, and that row is created by the S-1 or the 424. Run the 8-Ks first
 *     and every milestone is dropped while each filing still reports success. A
 *     SPAC with 58 8-Ks and no 424 produced an entirely empty timeline this way.
 *  2. The issuer's name and registration date come from the S-1, so a report
 *     built 424-first reads "(unknown)" with no registration.
 *  3. `spac_history` is a valid-time table: a filing older than the running
 *     `as_of` is anchored to that `as_of` instead of its own date, so
 *     out-of-order arrival yields a timeline whose validity windows are fiction.
 *
 * Serial and in date order, all three disappear — the state machine simply
 * replays history in the order it happened.
 *
 * Concurrency belongs BETWEEN issuers, not within one: SPACs are independent and
 * the writer already serializes per-CIK via `withCikLock`. Run this task once
 * per CIK and fan those out.
 */
export class ProcessSpacTimelineTask extends Task<
  ProcessSpacTimelineTaskInput,
  ProcessSpacTimelineTaskOutput
> {
  static readonly type = "ProcessSpacTimelineTask";
  static readonly category = "SEC";
  static readonly title = "Process a SPAC's filings in date order";
  static readonly cacheable = false;

  public static inputSchema() {
    return InputSchema();
  }

  public static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: ProcessSpacTimelineTaskInput,
    context: IExecuteContext
  ): Promise<ProcessSpacTimelineTaskOutput> {
    const { cik } = input;
    if (!cik) throw new TaskError("Invalid input");

    const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const all = (await filingRepo.query({ cik })) ?? [];

    // Only forms an extractor handles. Anything else has no storage handler and
    // would dead-letter as a wiring error rather than advance the timeline.
    const timeline = all
      .filter((f: Filing) => f.form !== null && formToExtractorId(f.form) !== undefined)
      // Sort by filing_date, then accession, so same-day filings still have a
      // deterministic order — two 8-Ks filed the same day must not race.
      .sort((a: Filing, b: Filing) => {
        // filing_date is nullable in the schema; an undated filing sorts LAST
        // rather than first, so it can never be replayed ahead of the S-1 that
        // creates the SPAC row and have its events silently dropped.
        const ad = a.filing_date ?? "9999-12-31";
        const bd = b.filing_date ?? "9999-12-31";
        return ad === bd ? a.accession_number.localeCompare(b.accession_number) : ad.localeCompare(bd);
      });

    if (timeline.length === 0) {
      return { matched: 0, processed: 0, firstDate: "", lastDate: "" };
    }

    const wf = context.own(new Workflow(), {
      title: `Replay ${timeline.length} filings for CIK ${cik} in date order`,
    });
    // concurrencyLimit 1 is the whole point: this is a replay, not a batch.
    const loop = wf.map({ concurrencyLimit: 1, maxIterations: timeline.length });
    loop.pipe(new ProcessAccessionDocFormTask());
    loop.endMap();
    await wf.run({
      cik: timeline.map(() => cik),
      form: timeline.map((f) => f.form),
      accessionNumber: timeline.map((f) => f.accession_number),
      fileName: timeline.map((f) => stripXslPrefix(f.primary_doc)),
    });

    return {
      matched: timeline.length,
      processed: timeline.length,
      firstDate: timeline[0]!.filing_date ?? "",
      lastDate: timeline[timeline.length - 1]!.filing_date ?? "",
    };
  }
}
