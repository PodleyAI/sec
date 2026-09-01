/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { FetchUrlTaskConfig, ITask } from "workglow";
import { Dataflow, globalServiceRegistry, IExecuteContext, Task, TaskGraph } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { assertInsideDir, sanitizePrimaryDoc, stripXslPrefix } from "../../util/accessionDocPath";
import { describeFailureReason } from "../../util/describeFailure";
import { parseDate } from "../../util/parseDate";
import { getHttpErrorStatus } from "../fetch/SecFetchJob";
import { SecFetchTask } from "../fetch/SecFetchTask";
import {
  REGA_FULL_SUBMISSION_FORMS,
  REGISTRATION_PROSPECTUS_FORMS,
} from "../forms/ProcessAccessionDocFormTask";
import { filingsForDate, listFilingDates, type FeedFiling } from "./feedFilings";
import { extractPrimaryDocFromSubmission } from "./feedTarball";
import {
  FeedTarballExtractTask,
  type FeedTarballExtractTaskOutput,
} from "./FeedTarballExtractTask";

export type BootstrapAccessionDocsTaskInput = {
  /** Inclusive lower bound (YYYY-MM-DD). Omit to start at the earliest filing. */
  readonly from?: string;
  /** Inclusive upper bound (YYYY-MM-DD). Omit to run through the latest filing. */
  readonly to?: string;
  /** Re-download days already marked complete and overwrite existing cache files. */
  readonly force?: boolean;
};

export type BootstrapAccessionDocsTaskOutput = {
  readonly success: boolean;
  /** Days whose Feed tarball was downloaded and extracted this run. */
  readonly daysProcessed: number;
  /** Accession documents written to the on-disk cache this run. */
  readonly docsWritten: number;
  /**
   * Days whose download or extraction threw. Counted rather than fatal — a
   * sweep can span thousands of days — and left unmarked, so a re-run retries
   * them. Distinct from `missing`, which is EDGAR not having published a day.
   */
  readonly failed: number;
};

/** Longest failure phrase kept per day, so one HTML error page cannot flood the log. */
const MAX_FEED_REASON_LENGTH = 200;

/**
 * Result of a day's Feed download derived from the tarball members. Used to
 * decide whether to write the resume marker (a genuine 404 must not).
 */
interface DayResult {
  readonly filingsMatched: number;
  readonly docsWritten: number;
}

/** EDGAR's daily Feed archive for one filing day. */
export function feedTarballUrl(date: string): string {
  const { year, month, day } = parseDate(date);
  const quarter = Math.ceil(parseInt(month, 10) / 3);
  return `https://www.sec.gov/Archives/edgar/Feed/${year}/QTR${quarter}/${year}${month}${day}.nc.tar.gz`;
}

/**
 * Downloads whole days of EDGAR filings as **Feed tarballs**
 * (`/Archives/edgar/Feed/YYYY/QTRn/YYYYMMDD.nc.tar.gz`) and populates the
 * on-disk accession-document cache the forms pipeline reads from — so the
 * bootstrap forms step serves documents from disk instead of making millions
 * of individually rate-limited per-document fetches.
 *
 * The days to fetch are exactly the distinct `filing_date` values of the
 * already-ingested submissions (optionally bounded by `[from, to]`), so this
 * only ever requests days EDGAR actually published and only keeps the filings
 * we know about. For each kept member it writes, mirroring
 * {@link SecFetchAccessionDocTask} / `readCachedDoc` paths exactly:
 * - the full-submission `.txt` for forms parsed from the full submission
 *   (S-1/424/DRS/F-1 prospectuses and 8-Ks, which SPAC narrative passes read); and
 * - the primary document, sliced losslessly from the submission SGML, for every
 *   other form,
 * so the fast path hits for all forms.
 *
 * Completed days are marked under `accessiondocs/.feed-done/` so a re-run
 * resumes where it left off; `force` re-downloads and overwrites.
 */
export class BootstrapAccessionDocsTask extends Task<
  BootstrapAccessionDocsTaskInput,
  BootstrapAccessionDocsTaskOutput
> {
  static readonly type = "BootstrapAccessionDocsTask";
  static readonly category = "SEC";
  static readonly title = "Download accession documents";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      from: Type.Optional(Type.String()),
      to: Type.Optional(Type.String()),
      force: Type.Optional(Type.Boolean()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
      daysProcessed: Type.Integer(),
      docsWritten: Type.Integer(),
      failed: Type.Integer(),
    });
  }

  /** Directories created this run, so we mkdir each CIK folder at most once. */
  private readonly createdDirs = new Set<string>();

  /**
   * The day's byte producer. A protected seam so the extract/write path is
   * unit-testable without the network — production returns the real
   * rate-limited fetch, tests return a task that yields a canned tarball, and
   * everything downstream of it (the graph edge, the sink, the walk, the
   * writes) is the same code in both.
   */
  protected createFeedFetchTask(date: string): ITask {
    return new SecFetchTask({ url: feedTarballUrl(date), response_type: "stream" }, {
      title: `Download ${date}`,
    } as FetchUrlTaskConfig);
  }

  private ensureDir(dir: string): void {
    if (this.createdDirs.has(dir)) return;
    mkdirSync(dir, { recursive: true });
    this.createdDirs.add(dir);
  }

  /**
   * Writes a full submission's cache files for one filing. Full-submission
   * consumers (registration prospectuses; 8-Ks) get the verbatim `.txt`; every
   * non-registration form additionally gets its primary document sliced out of
   * the submission SGML (skipped when it can't be lifted losslessly — the
   * forms fetcher then falls back to the network for just that document).
   */
  private writeFiling(
    rawDataFolder: string,
    filing: FeedFiling,
    submissionText: string,
    force: boolean
  ): number {
    const cik10 = String(filing.cik).padStart(10, "0");
    const accNoDash = filing.accession_number.replaceAll("-", "");
    const dir = join(rawDataFolder, "accessiondocs", cik10);
    const form = filing.form ?? "";
    const isRegistration = REGISTRATION_PROSPECTUS_FORMS.has(form);
    const isEightK = form === "8-K" || form === "8-K/A";
    // A Reg A ANNUAL report reads the full submission — its financials are in a
    // sibling <DOCUMENT>, not the primary doc — so the cache must hold the
    // `.txt` or every 1-K misses and falls back to the network. A 1-SA is not
    // in that set: its primary doc IS its report, so the slice above is already
    // the right file.
    const isRegAReport = REGA_FULL_SUBMISSION_FORMS.has(form);
    const primaryName = stripXslPrefix(filing.primary_doc ?? "").trim();
    // Pre-2003 EDGAR filings (and some later ones) carry no separate primary
    // document in the submissions metadata — the whole filing IS the `.txt`.
    // With no primary doc to slice, the full submission is the only content to
    // cache, so store it regardless of form.
    let hasPrimary = primaryName.length > 0;
    // `primary_doc` is filer-authored on the EDGAR submissions API; validate it
    // before composing any on-disk cache path so a hostile value can't escape
    // the cik directory. On rejection, fall through to the full-submission
    // fallback below rather than aborting the whole day's ingest.
    let safeName = "";
    if (hasPrimary) {
      try {
        safeName = sanitizePrimaryDoc(primaryName);
      } catch {
        console.warn(
          `Skipping unsafe primary_doc for cik=${filing.cik} accession=${filing.accession_number}: ${JSON.stringify(primaryName)}`
        );
        hasPrimary = false;
      }
    }

    let written = 0;

    // Primary document — for every non-registration form that has one
    // (registration forms read the full submission below, not the primary doc).
    // `sliced` stays false when the primary doc can't be lifted losslessly: the
    // submissions-API `primary_doc` doesn't match any `<FILENAME>` in the `.nc`
    // (some old filings record a mangled `<accession>-d1.html`), or the member
    // is binary. In that case the full submission is the fallback below so the
    // filing's content is still captured.
    let sliced = false;
    if (!isRegistration && hasPrimary) {
      const primaryPath = join(dir, `${accNoDash}-${safeName}`);
      assertInsideDir(primaryPath, dir);
      const alreadyCached = !force && existsSync(primaryPath);
      if (alreadyCached) {
        sliced = true;
      } else {
        const body = extractPrimaryDocFromSubmission(submissionText, primaryName);
        if (body !== undefined && body.length > 0) {
          this.ensureDir(dir);
          writeFileSync(primaryPath, body);
          written++;
          sliced = true;
        }
      }
    }

    // Full submission `.txt` — the fileName the full-submission forms request
    // is `<accession>.txt` (dashes kept), cached as `<accNoDash>-<fileName>`.
    // Stored for forms parsed from the full submission (registration
    // prospectuses, 8-Ks), for any filing lacking a primary document, and as the
    // fallback when a primary doc exists but could not be sliced.
    if (isRegistration || isEightK || isRegAReport || !hasPrimary || !sliced) {
      const fullSubPath = join(dir, `${accNoDash}-${filing.accession_number}.txt`);
      assertInsideDir(fullSubPath, dir);
      if (force || !existsSync(fullSubPath)) {
        this.ensureDir(dir);
        writeFileSync(fullSubPath, submissionText);
        written++;
      }
    }

    return written;
  }

  private async processDate(
    rawDataFolder: string,
    date: string,
    force: boolean,
    context: IExecuteContext
  ): Promise<DayResult | "missing"> {
    const filings = await filingsForDate(date);
    // One accession can have several filing rows — co-filers of a single
    // submission (13D/13G groups, joint filings) each get a `(cik,
    // accession)` row. EDGAR serves the identical document under every
    // co-filer's `…/data/<cik>/…` path, and the forms fast-path
    // (`readCachedDoc`) looks it up by the specific cik it is processing, so
    // the doc must be cached under EACH co-filer cik — not just one. Group the
    // rows by accession and write the member for every one.
    const byAccession = new Map<string, FeedFiling[]>();
    for (const f of filings) {
      const rows = byAccession.get(f.accession_number);
      if (rows) rows.push(f);
      else byAccession.set(f.accession_number, [f]);
    }

    // Two nodes: the fetch produces `body`, the sink consumes it. Nothing in
    // between materializes the day, and the download regains SafeFetch's
    // redirect checks, the SEC rate limiter, SecFetchJob's retry/backoff and
    // the 429 cluster-throttle signal that the raw fetch() bypass gave up.
    const fetchTask = this.createFeedFetchTask(date);
    const extractTask = new FeedTarballExtractTask({
      defaults: { byAccession },
      title: `Extract ${date}`,
    });
    extractTask.writeFiling = (filing, submissionText) =>
      this.writeFiling(rawDataFolder, filing, submissionText, force);

    const graph = context.own(new TaskGraph(), { title: `Feed ${date}` });
    graph.addTask(fetchTask);
    graph.addTask(extractTask);
    graph.addDataflow(new Dataflow(fetchTask.config.id, "body", extractTask.config.id, "body"));

    try {
      // `noAccumulation` is not a tuning knob here, it is the whole point:
      // without it `awaitStreamInputs` drains the edge to a value before the
      // sink starts, which is the ~1.5 GB day in memory. It also has to be an
      // explicitly named port edge with a single consumer, or the passthrough
      // check declines and the drain comes back.
      await graph.run(
        {},
        {
          noAccumulation: true,
          accumulateLeafOutputs: false,
          parentSignal: context.signal,
        }
      );
    } catch (error) {
      // A day EDGAR has not published a Feed archive for yet answers 404. That
      // is an expected outcome, not a failure: the caller leaves the day
      // unmarked so a later run retries it.
      if (getHttpErrorStatus(error) === 404) return "missing";
      throw error;
    } finally {
      context.disown(graph);
    }

    const summary = extractTask.runOutputData as Partial<FeedTarballExtractTaskOutput>;
    return {
      filingsMatched: summary.filingsMatched ?? 0,
      docsWritten: summary.docsWritten ?? 0,
    };
  }

  async execute(
    input: BootstrapAccessionDocsTaskInput,
    context: IExecuteContext
  ): Promise<BootstrapAccessionDocsTaskOutput> {
    const force = input.force ?? false;
    const rawDataFolder = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);

    const dates = await listFilingDates(input.from, input.to);

    if (isDryRun()) {
      const range =
        input.from || input.to ? ` in range [${input.from ?? "*"} .. ${input.to ?? "*"}]` : "";
      console.log(
        `Would download Feed tarballs for ${dates.length} filing day(s)${range} and extract accession documents into ${join(rawDataFolder, "accessiondocs")}`
      );
      return { success: true, daysProcessed: 0, docsWritten: 0, failed: 0 };
    }

    const doneDir = join(rawDataFolder, "accessiondocs", ".feed-done");
    mkdirSync(doneDir, { recursive: true });

    let daysProcessed = 0;
    let docsWritten = 0;
    let skipped = 0;
    let missing = 0;
    let failed = 0;

    for (let i = 0; i < dates.length; i++) {
      if (context.signal?.aborted) break;
      const date = dates[i];
      const { year, month, day } = parseDate(date);
      const marker = join(doneDir, `${year}${month}${day}`);

      if (!force && existsSync(marker)) {
        skipped++;
        continue;
      }

      context.updateProgress(
        Math.floor((i / Math.max(dates.length, 1)) * 100),
        `${date} · ${daysProcessed} days, ${docsWritten} docs`
      );

      let result: DayResult | "missing";
      try {
        result = await this.processDate(rawDataFolder, date, force, context);
      } catch (err) {
        if (context.signal?.aborted) throw err;
        // One bad day must not abort a multi-day sweep — a range can be
        // thousands of days and the ones already extracted are still worth
        // keeping. The marker is not written, so the next run retries it.
        failed++;
        console.warn(
          `Feed extraction failed for ${date}: ${describeFailureReason(err, MAX_FEED_REASON_LENGTH)}`
        );
        continue;
      }
      if (result === "missing") {
        // No Feed archive for this day yet (e.g. very recent). Do NOT mark it
        // done, so a later run retries once EDGAR publishes it.
        missing++;
        console.warn(`No Feed tarball published for ${date} yet; skipping (will retry next run).`);
        continue;
      }

      docsWritten += result.docsWritten;
      daysProcessed++;
      // Mark the day complete only after a clean extraction so a crash mid-day
      // re-runs it (writes are idempotent — cache files are immutable).
      writeFileSync(marker, "");
    }

    console.log(
      `Accession-doc bootstrap complete: ${daysProcessed} day(s) processed, ${docsWritten} document(s) written` +
        (skipped ? `, ${skipped} day(s) already done` : "") +
        (missing ? `, ${missing} day(s) not yet published` : "") +
        (failed ? `, ${failed} day(s) failed` : "") +
        `.`
    );

    return { success: true, daysProcessed, docsWritten, failed };
  }
}
