/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import {
  FetchUrlTaskOutput,
  globalServiceRegistry,
  IExecuteContext,
  Task,
  TaskAbortedError,
  TaskError,
  Workflow,
} from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../../storage/filing/FilingSchema";
import {
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  type SpacCandidateConfidence,
} from "../../storage/spac/SpacCandidateSchema";
import { assertInsideDir, sanitizePrimaryDoc, stripXslPrefix } from "../../util/accessionDocPath";
import { TypeSecCik } from "../../util/TypeSecCik";
import { extractPrimaryDocFromSubmission } from "../bootstrap/feedTarball";
import { FORMS_SWEEP_CONCURRENCY_LIMIT } from "../forms/formsSweep";
import { SecFetchAccessionDocTask } from "../forms/SecFetchAccessionDocTask";
import {
  DEFAULT_SPAC_DOWNLOAD_CONFIDENCE,
  MAX_SPAC_DOWNLOAD_CIKS_PER_QUERY,
  accessionDocCacheRelative,
  formsForDownloadSet,
  spacDocFetchFileName,
  type SpacDownloadSet,
} from "./spacCandidateDownload";

export type DownloadSpacCandidateDocsTaskInput = {
  readonly set: SpacDownloadSet;
  readonly confidence?: readonly SpacCandidateConfidence[];
  readonly force?: boolean;
};

export type DownloadSpacCandidateDocsTaskOutput = {
  readonly candidates: number;
  readonly matched: number;
  /** Total skipped — the sum of the three reasons below. */
  readonly skipped: number;
  /** Skipped because every file this filing needs was already on disk. */
  readonly skippedCached: number;
  /** Skipped because the filing names no document to fetch. */
  readonly skippedNoFileName: number;
  /** Skipped because the filer-authored filename could not be made path-safe. */
  readonly skippedUnsafeName: number;
  readonly downloaded: number;
  readonly failed: number;
  /**
   * An EXPECTED user error (e.g. an empty candidate table). Reported as an
   * output port rather than thrown: on a TTY the workflow renderer answers a
   * thrown error with `process.exit(1)`, which bypasses the command's error
   * handling and the CLI's teardown (job queue / pool shutdown).
   */
  readonly error?: string;
};

/** One filing's worth of work. Exported so a test seam can type its override. */
export type CacheOneInput = {
  readonly cik: number;
  readonly accessionNumber: string;
  readonly form: string;
  readonly fileName: string;
  readonly primaryDoc: string;
  readonly force?: boolean;
};

type CacheOneOutput = {
  readonly success: boolean;
  /**
   * Why the fetch failed, in one short phrase. Without it a 404, a 403 (EDGAR
   * blocking the User-Agent), an exhausted-retry 429 and "the response carried
   * no text" all sum into one counter and are indistinguishable — three of
   * which need completely different operator responses.
   */
  readonly reason?: string;
};

function isEightK(form: string): boolean {
  return form === "8-K" || form === "8-K/A";
}

/** Longest failure reason kept on a row, so one HTML error page cannot flood the log. */
const MAX_REASON_LENGTH = 160;

/**
 * One short phrase naming why a fetch failed, for the per-filing warning and
 * the grouped tally. Kept to the message so distinct causes — 404, 403, an
 * exhausted-retry 429, "no text" — stay distinguishable without a stack trace
 * per filing in a sweep that can fail thousands of times.
 */
function describeFetchFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const collapsed = message.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "unknown error";
  return collapsed.length > MAX_REASON_LENGTH
    ? `${collapsed.slice(0, MAX_REASON_LENGTH - 1)}…`
    : collapsed;
}

async function writeCacheFile(fullPath: string, dir: string, body: string): Promise<void> {
  assertInsideDir(fullPath, dir);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, body, "utf-8");
}

/**
 * One filing's cache fill. Hidden: the parent labels the sweep; this owns the
 * rate-limited fetch so a later forms sweep hits the same `accessiondocs` path.
 */
export class CacheOneSpacCandidateDocTask extends Task<CacheOneInput, CacheOneOutput> {
  static readonly type = "CacheOneSpacCandidateDocTask";
  static readonly category = "Hidden";
  static readonly title = "Download filing document";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      cik: TypeSecCik(),
      accessionNumber: Type.String(),
      form: Type.String(),
      fileName: Type.String(),
      primaryDoc: Type.String(),
      force: Type.Optional(Type.Boolean()),
    });
  }

  public static outputSchema() {
    return Type.Object({ success: Type.Boolean(), reason: Type.Optional(Type.String()) });
  }

  /**
   * Fetch seam. Production goes through {@link SecFetchAccessionDocTask}
   * (rate limiter + file cache). Tests override to return canned bodies.
   */
  protected async fetchDoc(
    cik: number,
    accessionNumber: string,
    fileName: string,
    context: IExecuteContext
  ): Promise<string> {
    const wf = context.own(new Workflow(), { title: `Fetch ${accessionNumber} ${fileName}` });
    let text: string | undefined;
    wf.pipe(
      new SecFetchAccessionDocTask({ cik, accessionNumber, fileName }),
      async function capture(fetchOutput: FetchUrlTaskOutput) {
        text = fetchOutput.text ?? undefined;
        return { success: true };
      }
    );
    try {
      await wf.run();
    } finally {
      for (const dataflow of wf.graph.getDataflows()) {
        dataflow.reset();
      }
      for (const task of wf.graph.getTasks()) {
        task.resetInputData();
        task.runOutputData = {};
        task.error = undefined;
      }
      context.disown(wf);
    }
    if (!text) {
      throw new TaskError(`Fetch returned no text for ${cik}/${accessionNumber}/${fileName}`);
    }
    return text;
  }

  async execute(input: CacheOneInput, context: IExecuteContext): Promise<CacheOneOutput> {
    const { cik, accessionNumber, form, fileName, primaryDoc } = input;
    const force = input.force === true;
    // No progress report here. This task runs on the PARENT's context, so N
    // concurrent workers each wrote their own filing's label over the previous
    // one and the percentage never moved off 0. The parent reports progress
    // from worker completions instead.

    if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
      throw new TaskError("SEC_RAW_DATA_FOLDER is not configured");
    }
    const raw = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const cikDir = path.join(raw, "accessiondocs", String(cik).padStart(10, "0"));
    const requiredPath = path.join(raw, accessionDocCacheRelative(cik, accessionNumber, fileName));

    let text: string;
    const requiredExists = existsSync(requiredPath);
    if (requiredExists && !force) {
      text = await readFile(requiredPath, "utf-8");
    } else {
      try {
        text = await this.fetchDoc(cik, accessionNumber, fileName, context);
      } catch (err) {
        if (err instanceof TaskAbortedError) throw err;
        if (context.signal?.aborted) throw new TaskAbortedError();
        // A binary primary document (`.pdf`, `.jpg`, …) resolves to
        // `response_type: "blob"`, so `fetchOutput.text` is undefined and
        // `fetchDoc` throws "Fetch returned no text" — AFTER the fetch task's
        // own file cache already wrote the bytes. The document is cached; the
        // filing is not a failure, and only the text-only slice step below is
        // unavailable (which no binary form uses). Reachable on `everything`
        // for any primary-doc form.
        if (existsSync(requiredPath)) return { success: true };
        return { success: false, reason: describeFetchFailure(err) };
      }
      await writeCacheFile(requiredPath, cikDir, text);
    }

    if (isEightK(form) && primaryDoc.trim().length > 0) {
      try {
        const safeName = sanitizePrimaryDoc(stripXslPrefix(primaryDoc));
        const sliced = extractPrimaryDocFromSubmission(text, safeName);
        if (sliced !== undefined) {
          const primaryPath = path.join(
            raw,
            accessionDocCacheRelative(cik, accessionNumber, safeName)
          );
          if (force || !existsSync(primaryPath)) {
            await writeCacheFile(primaryPath, cikDir, sliced);
          }
        }
      } catch {
        // Unsafe primary_doc: keep the required .txt, skip the slice.
      }
    }

    return { success: true };
  }
}

export class DownloadSpacCandidateDocsTask extends Task<
  DownloadSpacCandidateDocsTaskInput,
  DownloadSpacCandidateDocsTaskOutput
> {
  static readonly type = "DownloadSpacCandidateDocsTask";
  static readonly category = "SEC";
  static readonly title = "Download SPAC candidate documents";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      set: Type.Union([Type.Literal("registration"), Type.Literal("8k"), Type.Literal("all")]),
      confidence: Type.Optional(Type.Array(Type.String())),
      force: Type.Optional(Type.Boolean()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      candidates: Type.Integer(),
      matched: Type.Integer(),
      skipped: Type.Integer(),
      skippedCached: Type.Integer(),
      skippedNoFileName: Type.Integer(),
      skippedUnsafeName: Type.Integer(),
      downloaded: Type.Integer(),
      failed: Type.Integer(),
      error: Type.Optional(Type.String()),
    });
  }

  /**
   * Test seam: subclass and return a CacheOne that stubs
   * {@link CacheOneSpacCandidateDocTask.fetchDoc}.
   *
   * Takes the item so the instance can carry a per-instance `title` — the CLI
   * progress UI labels every row with it, and the whole sweep is instances of
   * one class. No `defaults`: `force` arrives on the item this task is executed
   * with, so seeding it as a default was dead weight.
   */
  protected createInnerTask(item: CacheOneInput): CacheOneSpacCandidateDocTask {
    return new CacheOneSpacCandidateDocTask({
      title: `${item.form} ${item.accessionNumber}`,
    });
  }

  async execute(
    input: DownloadSpacCandidateDocsTaskInput,
    context: IExecuteContext
  ): Promise<DownloadSpacCandidateDocsTaskOutput> {
    if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
      throw new TaskError("SEC_RAW_DATA_FOLDER is not configured");
    }
    const raw = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const force = input.force === true;
    const wanted = new Set<string>(input.confidence ?? DEFAULT_SPAC_DOWNLOAD_CONFIDENCE);

    const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    const candidates = ((await candidateRepo.getAll()) ?? []).filter((row) =>
      wanted.has(row.confidence)
    );
    if (candidates.length === 0) {
      // An EXPECTED user error, so it leaves on the `error` port rather than
      // being thrown: the workflow renderer answers a throw with
      // `process.exit(1)`, which skips the command's error handling and the
      // CLI's teardown. (The SEC_RAW_DATA_FOLDER check above stays a throw — a
      // misconfiguration is not an expected user error.)
      return {
        ...emptyResult(0, 0),
        error:
          "No SPAC candidates in the requested confidence tier(s). Run `sec update spacs` first.",
      };
    }

    const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const ciks = candidates.map((c) => c.cik);
    const filings: Filing[] = [];
    for (let start = 0; start < ciks.length; start += MAX_SPAC_DOWNLOAD_CIKS_PER_QUERY) {
      const chunk = ciks.slice(start, start + MAX_SPAC_DOWNLOAD_CIKS_PER_QUERY);
      const rows = (await filingRepo.query({ cik: { value: chunk, operator: "in" } })) ?? [];
      filings.push(...rows);
    }

    const formSet = formsForDownloadSet(input.set);
    const matchedRows = filings.filter((f) => {
      const form = f.form ?? "";
      if (form.length === 0) return false;
      return formSet === undefined || formSet.has(form);
    });

    const todo: CacheOneInput[] = [];
    // Three different situations, kept as three counters: "already have it" is
    // the healthy steady state, "the filing names no document" is an EDGAR
    // shape, and "the name is not path-safe" is a filer-authored value worth
    // looking at. One shared counter said only "nothing happened".
    let skippedCached = 0;
    let skippedNoFileName = 0;
    let skippedUnsafeName = 0;
    for (const row of matchedRows) {
      const form = row.form ?? "";
      const fileName = spacDocFetchFileName(form, row.accession_number, row.primary_doc);
      if (fileName.trim().length === 0) {
        skippedNoFileName++;
        continue;
      }
      try {
        sanitizePrimaryDoc(fileName);
      } catch {
        skippedUnsafeName++;
        console.warn(
          `Skipping unsafe document name for cik=${row.cik} accession=${row.accession_number}: ` +
            JSON.stringify(fileName)
        );
        continue;
      }
      if (
        !force &&
        shouldSkipCached(raw, row.cik, row.accession_number, form, fileName, row.primary_doc)
      ) {
        skippedCached++;
        continue;
      }
      todo.push({
        cik: row.cik,
        accessionNumber: row.accession_number,
        form,
        fileName,
        primaryDoc: row.primary_doc,
        force,
      });
    }

    const skips = { skippedCached, skippedNoFileName, skippedUnsafeName };

    if (isDryRun() || todo.length === 0) {
      return { ...emptyResult(candidates.length, matchedRows.length), ...skips, ...totals(skips) };
    }

    let downloaded = 0;
    let failed = 0;
    let next = 0;
    const failuresByReason = new Map<string, number>();
    const skippedTotal = totals(skips).skipped;
    const report = (): void => {
      const done = downloaded + failed;
      void context.updateProgress(
        Math.floor((done / todo.length) * 100),
        // A COUNTER, not the current filing: with FORMS_SWEEP_CONCURRENCY_LIMIT
        // workers reporting into one context, a per-filing label is only ever
        // the last one to win a race.
        `${downloaded} downloaded · ${skippedTotal} skipped · ${failed} failed`
      );
    };
    const worker = async (): Promise<void> => {
      while (true) {
        if (context.signal?.aborted) throw new TaskAbortedError();
        const i = next++;
        if (i >= todo.length) return;
        const item = todo[i];
        const inner = this.createInnerTask(item);
        const result = await inner.execute(item, context);
        if (result.success) {
          downloaded++;
        } else {
          failed++;
          const reason = result.reason ?? "unknown error";
          failuresByReason.set(reason, (failuresByReason.get(reason) ?? 0) + 1);
          console.warn(
            `${item.cik}/${item.accessionNumber} · ${item.form} · ${item.fileName} → ${reason}`
          );
        }
        report();
      }
    };
    const n = Math.min(FORMS_SWEEP_CONCURRENCY_LIMIT, todo.length);
    // allSettled, not all: `Promise.all` rejects on the first TaskAbortedError
    // while up to n-1 fetch+write pairs are still in flight, so their writes
    // landed after `execute` had already thrown. Wait for every worker to
    // settle, then re-raise.
    const settled = await Promise.allSettled(Array.from({ length: n }, () => worker()));
    const firstRejection = settled.find((s) => s.status === "rejected");
    if (firstRejection && firstRejection.status === "rejected") {
      throw firstRejection.reason;
    }

    if (failuresByReason.size > 0) {
      const tally = [...failuresByReason.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => `  ${count} × ${reason}`)
        .join("\n");
      console.warn(`SPAC doc download: ${failed} filing(s) failed:\n${tally}`);
    }

    return {
      candidates: candidates.length,
      matched: matchedRows.length,
      ...skips,
      ...totals(skips),
      downloaded,
      failed,
    };
  }
}

interface SkipCounts {
  readonly skippedCached: number;
  readonly skippedNoFileName: number;
  readonly skippedUnsafeName: number;
}

/** `skipped` stays the sum of its parts, so no caller has to add them up. */
function totals(skips: SkipCounts): { readonly skipped: number } {
  return {
    skipped: skips.skippedCached + skips.skippedNoFileName + skips.skippedUnsafeName,
  };
}

function emptyResult(candidates: number, matched: number): DownloadSpacCandidateDocsTaskOutput {
  return {
    candidates,
    matched,
    skipped: 0,
    skippedCached: 0,
    skippedNoFileName: 0,
    skippedUnsafeName: 0,
    downloaded: 0,
    failed: 0,
  };
}

function shouldSkipCached(
  raw: string,
  cik: number,
  accessionNumber: string,
  form: string,
  fileName: string,
  primaryDoc: string
): boolean {
  const requiredPath = path.join(raw, accessionDocCacheRelative(cik, accessionNumber, fileName));
  if (!existsSync(requiredPath)) return false;
  if (!isEightK(form)) return true;
  try {
    const safeName = sanitizePrimaryDoc(stripXslPrefix(primaryDoc));
    const primaryPath = path.join(raw, accessionDocCacheRelative(cik, accessionNumber, safeName));
    return existsSync(primaryPath);
  } catch {
    return true;
  }
}
