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
import { SecCliConfigurationError } from "../../config/EnvToDI";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import { type Filing, FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { formToExtractorId } from "../../storage/versioning/extractorIds";
import { resolvePrimaryDocName } from "../../util/accessionDocPath";
import { ProcessAccessionDocFormTask } from "../forms/ProcessAccessionDocFormTask";

const InputSchema = () =>
  Type.Object({
    cik: TypeSecCik(),
  });

export type ProcessSpacTimelineTaskInput = Static<ReturnType<typeof InputSchema>>;

const OutputSchema = () =>
  Type.Object({
    // Echoed so a fan-out's index-aligned result columns are self-labelling:
    // the caller reports per-issuer outcomes and must never mis-attribute one.
    cik: Type.Number({ title: "CIK", description: "The issuer these counts belong to." }),
    matched: Type.Number({ title: "Matched", description: "Filings on the issuer's timeline." }),
    processed: Type.Number({
      title: "Processed",
      description: "Filings whose latest extractor run was `success`.",
    }),
    partial: Type.Number({
      title: "Partial",
      description: "Filings where some sections extracted and others dead-lettered.",
    }),
    failed: Type.Number({
      title: "Failed",
      description: "Filings whose latest run was `failure`, or that wrote no run row.",
    }),
    triage: Type.Number({
      title: "Triage entries",
      description: "Pending dead-letter entries across the replayed filings.",
    }),
    firstDate: Type.String({ title: "First", description: "Earliest filing_date processed." }),
    lastDate: Type.String({ title: "Last", description: "Latest filing_date processed." }),
    error: Type.String({
      title: "Error",
      description: "Failure message for this issuer, or '' when it replayed.",
    }),
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
 *
 * A failure on one issuer is reported through the `error` output port rather
 * than thrown, so a fan-out over many issuers finishes the rest of the batch.
 * Cancellation and configuration errors still escape — neither is a verdict
 * about this issuer, and swallowing them would turn Ctrl-C into a batch of
 * per-issuer "failures".
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
    try {
      return await this.replay(cik, context);
    } catch (e) {
      // Cooperative cancellation and a misconfigured CLI are wrong for the
      // whole batch, not for this issuer, so they keep escaping. Checked in
      // that order for the reason `sectionRunner` uses: once an abort is in
      // flight, whatever a torn-down call surfaces is teardown noise.
      if (e instanceof TaskAbortedError) throw e;
      if (context.signal?.aborted === true) {
        const aborted = new TaskAbortedError();
        aborted.cause = e;
        throw aborted;
      }
      if (e instanceof SecCliConfigurationError) throw e;
      return emptyOutcome(cik, e instanceof Error ? e.message : String(e));
    }
  }

  private async replay(
    cik: number,
    context: IExecuteContext
  ): Promise<ProcessSpacTimelineTaskOutput> {
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
        return ad === bd
          ? a.accession_number.localeCompare(b.accession_number)
          : ad.localeCompare(bd);
      });

    if (timeline.length === 0) {
      return emptyOutcome(cik, "");
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
      // `primary_doc` is nullable and `stripXslPrefix` is not: one filing
      // without a primary document threw out of the whole issuer's replay.
      // Left absent, the form task resolves it or dead-letters that one filing.
      fileName: timeline.map((f) => resolvePrimaryDocName(f.primary_doc)),
    });

    // Counts come from the persisted `extractor_runs` rows rather than the
    // sub-task's boolean. ProcessAccessionDocFormTask returns `{ success: true }`
    // whenever store did not throw — including when a section dead-lettered and
    // the run was recorded `partial`. Counting that boolean printed "52/52
    // filings" for a CIK whose DRS underwriters section came back MODEL_EMPTY.
    const counts = await countTimelineOutcomes(cik, timeline);
    return {
      cik,
      matched: timeline.length,
      processed: counts.succeeded,
      partial: counts.partial,
      failed: counts.failed,
      triage: counts.triage,
      firstDate: timeline[0]!.filing_date ?? "",
      lastDate: timeline[timeline.length - 1]!.filing_date ?? "",
      error: "",
    };
  }
}

function emptyOutcome(cik: number, error: string): ProcessSpacTimelineTaskOutput {
  return {
    cik,
    matched: 0,
    processed: 0,
    partial: 0,
    failed: 0,
    triage: 0,
    firstDate: "",
    lastDate: "",
    error,
  };
}

/**
 * Per-filing outcomes for one issuer's replay, matching the form-fetch
 * counter: the form's own extractor, newest run by `ran_at`, and every
 * pending dead-letter on those accessions (including sub-extractors). A
 * filing with no run row for its extractor counts as failed.
 */
async function countTimelineOutcomes(
  cik: number,
  timeline: readonly Filing[]
): Promise<{
  readonly succeeded: number;
  readonly partial: number;
  readonly failed: number;
  readonly triage: number;
}> {
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  const deadLetterRepo = globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN);
  let succeeded = 0;
  let partial = 0;
  let failed = 0;
  let triage = 0;
  for (const filing of timeline) {
    const extractorId = filing.form !== null ? formToExtractorId(filing.form) : undefined;
    if (extractorId === undefined) {
      failed++;
      continue;
    }
    const latest = await runRepo.findLatestRun(cik, filing.accession_number, extractorId);
    if (latest?.outcome === "success") succeeded++;
    else if (latest?.outcome === "partial") partial++;
    else failed++;

    const pending =
      (await deadLetterRepo.query({
        accession_number: filing.accession_number,
        status: "pending",
      })) ?? [];
    triage += pending.length;
  }
  return { succeeded, partial, failed, triage };
}
