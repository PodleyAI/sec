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
import { isDryRun } from "../../cli/isDryRun";
import { SecCliConfigurationError } from "../../config/EnvToDI";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import { type Filing } from "../../storage/filing/FilingSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import {
  formToExtractorId,
  isNonfatalTimelineExtractor,
} from "../../storage/versioning/extractorIds";
import { resolvePrimaryDocName } from "../../util/accessionDocPath";
import { ProcessAccessionDocFormTask } from "../forms/ProcessAccessionDocFormTask";
import { parseSpacProcessForce, type SpacProcessForce } from "./parseSpacProcessForce";
import { planSpacTimeline, planSpacTimelineRepair } from "./planSpacTimeline";
import { resetSpacProcessState } from "./resetSpacProcessState";

const InputSchema = () =>
  Type.Object({
    cik: TypeSecCik(),
    force: Type.Optional(Type.String()),
    // Inclusive filing-date floor. `sync spacs --only updates` uses this so a
    // daily delta does not replay leftover historical filings of an already
    // processed issuer. Undated filings are never excluded: they sort last on
    // the timeline and dropping them would hide work with no date to compare.
    filedOnOrAfter: Type.Optional(Type.String()),
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
      description:
        "Filings whose latest run was `failure`, or that wrote no run row — excluding ownership forms (3/4/5/144), which are counted as `nonfatal`.",
    }),
    nonfatal: Type.Number({
      title: "Nonfatal",
      description:
        "Ownership-form filings (3/4/5/144) whose latest run was `failure` or that wrote no run row. Off the SPAC timeline's critical path; does not fail `spac process`.",
    }),
    skipped: Type.Number({
      title: "Skipped",
      description: "Filings not sent to the form processor because they already succeeded.",
    }),
    triage: Type.Number({
      title: "Triage entries",
      description: "Pending dead-letter entries across the replayed filings.",
    }),
    // Scalar (comma-separated) rather than an array: the `spac process` fan-out
    // merges each port into an index-aligned column, and an array would nest.
    triageExtractors: Type.String({
      title: "Triage extractors",
      description:
        "Sorted unique extractor ids with pending dead-letters on this issuer, comma-separated.",
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
 * Case 1 also needs a second, capped pass. Gated extractors are omitted from
 * the first pass while the `spac` row is missing: otherwise a candidate that
 * never mints (or an 8-K dated before the S-1) no-ops, records success, and
 * warns. {@link loadGatedNoOpAccessions} then selects them once the row exists,
 * including ones a prior sweep already no-op'd. The S-1 that mints the row is
 * normally on this very timeline, so the set is empty when first computed and
 * is recomputed after the replay. Whatever it still names, minus what this
 * invocation already processed, is replayed once more, serially, in timeline
 * order. One extra pass, never a loop: the gated predicates are monotone, so
 * a filing that is processed leaves the set.
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
/**
 * Finished filing rows kept on the issuer's subgraph. Well above any timeline a
 * person watches scroll past, and far below the thousands a de-SPAC'd operating
 * company accumulates.
 */
export const MAX_RETAINED_FILING_ROWS = 250;

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
    this.setTitle(`CIK ${cik}`);
    try {
      return await this.replay(
        cik,
        parseSpacProcessForce(input.force),
        emptyToUndefined(input.filedOnOrAfter),
        context
      );
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
    force: SpacProcessForce,
    filedOnOrAfter: string | undefined,
    context: IExecuteContext
  ): Promise<ProcessSpacTimelineTaskOutput> {
    // The selection itself lives in `planSpacTimeline`, shared with the web
    // inspector so the checklist an operator sees and the work this replays are
    // computed once rather than twice.
    const plan = await planSpacTimeline({ cik, force, filedOnOrAfter });
    const { timeline, toProcess, skipped, activeVersions, firstDate, lastDate } = plan;

    if (timeline.length === 0) {
      return emptyOutcome(cik, "");
    }

    // `--dry-run` already no-ops writes via ReadOnlyTabularStorage. Replaying
    // still makes live model.info / extraction calls, then reads outcome
    // counts from extractor_runs rows that were never written, so every
    // filing looks failed. Count the timeline; do not run the form processor.
    if (isDryRun()) {
      return {
        cik,
        matched: timeline.length,
        processed: 0,
        partial: 0,
        failed: 0,
        nonfatal: 0,
        triage: 0,
        skipped,
        triageExtractors: "",
        firstDate,
        lastDate,
        error: "",
      };
    }

    if (force.kind === "all") {
      try {
        await resetSpacProcessState(cik, activeVersions);
      } catch (e) {
        return emptyOutcome(cik, e instanceof Error ? e.message : String(e));
      }
    }

    const processedAccessions = new Set<string>();
    if (toProcess.length > 0) {
      await this.replayFilings(toProcess, cik, context);
      for (const f of toProcess) processedAccessions.add(f.accession_number);
    }

    // The repair pass, and the reason `spac process` exists at all.
    //
    // `gatedNoOpAccessions` returns the empty set for a CIK with no `spac` row,
    // and the canonical broken state this command targets is "8-Ks swept before
    // the registration statement was processed" — where the row does not exist
    // when the set is computed and the S-1 that mints it is replayed a moment
    // later, in THIS run. Every gated filing was therefore filtered out before
    // the row appeared: a CIK with 58 gated 8-Ks reported `skipped: 58` and an
    // empty timeline, and only a second, identical invocation repaired it, with
    // nothing anywhere saying so.
    //
    // Recompute now that the replay has run, minus everything already sent to
    // the processor in this invocation. Capped at ONE extra pass and
    // deliberately not a fixpoint loop: every gated predicate is monotone
    // (processing a filing writes the event / extraction row / dead-letter
    // entry the predicate keys on), so one pass suffices for the
    // row-minted-mid-run case, while a cap cannot spin if a non-convergent
    // shape is ever reintroduced.
    //
    // `--force all` replayed every timeline filing, so the remainder is empty
    // by construction; the size guard states that rather than special-casing it.
    const repair = await planSpacTimelineRepair({
      cik,
      timeline,
      processedAccessions,
      filedOnOrAfter,
    });
    if (repair.length > 0) {
      await this.replayFilings(repair, cik, context);
      for (const f of repair) processedAccessions.add(f.accession_number);
    }

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
      nonfatal: counts.nonfatal,
      triage: counts.triage,
      // Counted against what was actually sent to the processor, across both
      // passes — a filing the repair pass picked up was not skipped.
      skipped: timeline.length - processedAccessions.size,
      triageExtractors: counts.triageExtractors,
      firstDate,
      lastDate,
      error: "",
    };
  }

  /**
   * One serial pass over `filings`, in the order given. Each filing is an owned
   * child of this issuer so the CLI nests `form accession` rows under the CIK
   * — an inner Workflow+Map sat below the renderer's recursion cap and the
   * issuer row had no children.
   */
  private async replayFilings(
    filings: readonly Filing[],
    cik: number,
    context: IExecuteContext
  ): Promise<void> {
    // `own` is add-only and the subgraph is cleared only between graph runs, so
    // one child per filing retains every child — and everything each child
    // owned in turn — for the whole of `execute()`. That is unbounded in the
    // length of the timeline: a de-SPAC'd operating company runs to thousands
    // of filings (the 424B2 shelf-takedown case), multiplied by `--concurrency`
    // issuers in flight.
    //
    // The completed rows are not merely debris, though — they are why these are
    // owned directly rather than through the inner Workflow+Map this replaced,
    // which the CLI stops recursing into, leaving the issuer row with no filing
    // children at all. So the cap keeps the nesting for the timelines a person
    // actually watches and releases the tail, rather than trading one defect
    // for the other. Past it the in-flight filing is still owned while it runs;
    // only its finished row is dropped.
    let retained = 0;
    for (const filing of filings) {
      const form = filing.form ?? "";
      const child = context.own(
        new ProcessAccessionDocFormTask({
          title: `${form} ${filing.accession_number}`,
        })
      );
      try {
        await child.run({
          cik,
          form,
          accessionNumber: filing.accession_number,
          fileName: resolvePrimaryDocName(filing.primary_doc),
        });
      } finally {
        if (retained < MAX_RETAINED_FILING_ROWS) {
          retained++;
        } else {
          context.disown(child);
        }
      }
    }
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  return value;
}

function emptyOutcome(cik: number, error: string): ProcessSpacTimelineTaskOutput {
  return {
    cik,
    matched: 0,
    processed: 0,
    partial: 0,
    failed: 0,
    nonfatal: 0,
    triage: 0,
    skipped: 0,
    triageExtractors: "",
    firstDate: "",
    lastDate: "",
    error,
  };
}

/**
 * Per-filing outcomes for one issuer's replay, matching the form-fetch
 * counter: the form's own extractor, newest run by `ran_at`, and every
 * pending dead-letter on those accessions (including sub-extractors). A
 * filing with no run row for its extractor counts as failed, except ownership
 * forms (3/4/5/144) which count as `nonfatal`.
 */
async function countTimelineOutcomes(
  cik: number,
  timeline: readonly Filing[]
): Promise<{
  readonly succeeded: number;
  readonly partial: number;
  readonly failed: number;
  readonly nonfatal: number;
  readonly triage: number;
  readonly triageExtractors: string;
}> {
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  const deadLetterRepo = globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN);
  let succeeded = 0;
  let partial = 0;
  let failed = 0;
  let nonfatal = 0;
  let triage = 0;
  const extractorIds = new Set<string>();
  for (const filing of timeline) {
    const extractorId = filing.form !== null ? formToExtractorId(filing.form) : undefined;
    if (extractorId === undefined) {
      failed++;
      continue;
    }
    const latest = await runRepo.findLatestRun(cik, filing.accession_number, extractorId);
    if (latest?.outcome === "success") succeeded++;
    else if (latest?.outcome === "partial") partial++;
    else if (isNonfatalTimelineExtractor(extractorId)) nonfatal++;
    else failed++;

    const pending =
      (await deadLetterRepo.query({
        accession_number: filing.accession_number,
        status: "pending",
      })) ?? [];
    triage += pending.length;
    for (const row of pending) {
      extractorIds.add(row.extractor_id);
    }
  }
  return {
    succeeded,
    partial,
    failed,
    nonfatal,
    triage,
    triageExtractors: [...extractorIds].sort().join(","),
  };
}
