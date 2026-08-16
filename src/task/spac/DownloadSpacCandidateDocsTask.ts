/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import {
  globalServiceRegistry,
  IExecuteContext,
  type PageCursor,
  type SearchCriteria,
  Task,
  TaskAbortedError,
  TaskError,
  Workflow,
} from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { type Filing, FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import {
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  type SpacCandidateConfidence,
} from "../../storage/spac/SpacCandidateSchema";
import {
  assertInsideDir,
  resolvePrimaryDocName,
  sanitizePrimaryDoc,
} from "../../util/accessionDocPath";
import { tmpPathFor } from "../../util/atomicFileWrite";
import { describeFailureReason } from "../../util/describeFailure";
import { TypeSecCik } from "../../util/TypeSecCik";
import { extractPrimaryDocFromSubmission } from "../bootstrap/feedTarball";
import { FORMS_SWEEP_CONCURRENCY_LIMIT } from "../forms/formsSweep";
import { SecFetchAccessionDocTask } from "../forms/SecFetchAccessionDocTask";
import {
  accessionDocCacheRelative,
  DEFAULT_SPAC_DOWNLOAD_CONFIDENCE,
  formsForDownloadSet,
  SPAC_DOWNLOAD_FILING_PAGE_SIZE,
  spacDocFetchFileName,
  spacDownloadCikChunkSize,
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
   * blocking the User-Agent) and an exhausted-retry 429 all sum into one
   * counter and are indistinguishable — three causes needing completely
   * different operator responses.
   */
  readonly reason?: string;
};

function isEightK(form: string): boolean {
  return form === "8-K" || form === "8-K/A";
}

/** Longest failure reason kept on a row, so one HTML error page cannot flood the log. */
const MAX_REASON_LENGTH = 160;

/**
 * Writes a cache file the way {@link SecFetchFileOutputCache} does: to a unique
 * tmp name, then `rename` onto the final path. A plain `writeFile` leaves a
 * truncated entry behind when the process is interrupted mid-write, and two
 * concurrent writers targeting the same key can interleave bytes — and this
 * task runs {@link FORMS_SWEEP_CONCURRENCY_LIMIT} writers at once. A truncated
 * accession document is worse than a missing one: the forms sweep reads it as a
 * cache hit and parses garbage.
 */
async function writeFileAtomic(fullPath: string, dir: string, body: string): Promise<void> {
  assertInsideDir(fullPath, dir);
  await mkdir(path.dirname(fullPath), { recursive: true });
  const tmpPath = tmpPathFor(fullPath);
  try {
    await writeFile(tmpPath, body, "utf-8");
    await rename(tmpPath, fullPath);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Deletes a cache entry so a `--force` re-fetch actually re-fetches.
 *
 * The fetch path composes its cache filename identically to
 * {@link accessionDocCacheRelative} and installs a {@link SecFetchFileOutputCache}
 * as `runConfig.outputCache`; the task runner consults that cache before
 * `execute`, and with no `date` input the cache has no freshness branch to
 * fail — so without this unlink the "re-fetch" is served from the very file the
 * operator asked to replace, and a corrupt entry can never be evicted.
 *
 * Unlinking is the eviction, rather than a cache-bypass flag, because
 * `CacheCoordinator.lookup` and `.save` are gated by the same condition pair
 * (`!outputCache || !task.cacheable`): any bypass knob suppresses the WRITE as
 * well as the read, which would force a hand-rolled non-atomic write back into
 * the one place this file is removing it. With the entry gone, `getOutput`
 * takes its ENOENT miss path and `saveOutput`'s tmp+rename stays the single
 * atomic writer.
 *
 * The cost is that the eviction precedes the fetch, so a `--force` run whose
 * fetch then fails leaves NO cached document — the entry it deleted is not
 * restored, and a merely-stale cache ends up empty. `sec bootstrap
 * download-docs --force` has no such window: it streams from a tarball and
 * overwrites once the bytes are in hand. There is no fetch-then-replace
 * ordering available here, because the runner consults the cache before
 * `execute` ever runs; the loss shows up in the sweep's `failed` count and a
 * re-run refills it.
 */
async function evictCacheFile(fullPath: string, dir: string): Promise<void> {
  assertInsideDir(fullPath, dir);
  await rm(fullPath, { force: true });
}

/**
 * Once per process, not once per filing: a sweep degraded this way degrades for
 * every one of its thousands of filings, and the operator needs the fact, not
 * the count.
 */
let warnedMissingCacheFile = false;
function warnMissingCacheFileOnce(): void {
  if (warnedMissingCacheFile) return;
  warnedMissingCacheFile = true;
  console.warn(
    "SPAC doc download: the fetch reported success but left no cache file. " +
      "The download path streams to the file cache, so nothing else holds the bytes; " +
      "in production this means SEC_RAW_DATA_FOLDER was not registered when the fetch task was built."
  );
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
   * (rate limiter + file cache) with `response_type: "stream"` — this command
   * exists to FILL the cache, not to read it, so nothing here wants the
   * document as a value. The cache file is the artifact and success is the
   * absence of an error; there is nothing to return.
   *
   * The seam's contract is therefore that the bytes end up at the cache path,
   * and an override that returns without writing one is a broken seam, not a
   * fetch this task can paper over.
   */
  protected async fetchDoc(
    cik: number,
    accessionNumber: string,
    fileName: string,
    context: IExecuteContext
  ): Promise<void> {
    const wf = context.own(new Workflow(), { title: `Fetch ${accessionNumber} ${fileName}` });
    wf.pipe(
      new SecFetchAccessionDocTask({ cik, accessionNumber, fileName, response_type: "stream" })
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

    // `fileName` arrives on a data port that accepts any string, and this task
    // is exported — the parent's worklist sanitization is not a substitute.
    // Guard the READ the same way `ProcessAccessionDocFormTask.readCachedDoc`
    // does; an unsafe name is a cache miss, not a path to open.
    let cacheReadable = existsSync(requiredPath) && !force;
    if (cacheReadable) {
      try {
        sanitizePrimaryDoc(fileName);
        assertInsideDir(requiredPath, cikDir);
      } catch {
        cacheReadable = false;
      }
    }
    if (!cacheReadable) {
      if (force && !isDryRun()) {
        // Evict BEFORE fetching: the fetch task's own file cache keys off this
        // exact path, so a surviving entry short-circuits the re-fetch.
        await evictCacheFile(requiredPath, cikDir);
      }
      try {
        await this.fetchDoc(cik, accessionNumber, fileName, context);
      } catch (err) {
        if (err instanceof TaskAbortedError) throw err;
        if (context.signal?.aborted) throw new TaskAbortedError();
        return { success: false, reason: describeFailureReason(err, MAX_REASON_LENGTH) };
      }
      // Streaming makes the cache file the whole result, so its absence is the
      // only way this fetch can have failed silently — there is no returned
      // value left to fall back to. In production the SEC_RAW_DATA_FOLDER
      // check at the top of this method guarantees the fetch task installs an
      // output cache, so reaching here means a seam that did not honor its
      // contract.
      //
      // Except under `--dry-run`, where the cache deliberately drains the body
      // and writes nothing: an absent file is the expected outcome there, and
      // reporting it as a failure made a dry run tally every filing as failed
      // under a reason that blames a DI misconfiguration.
      if (!isDryRun() && !existsSync(requiredPath)) {
        warnMissingCacheFileOnce();
        return {
          success: false,
          reason: "fetch completed but wrote no cache file",
        };
      }
    }

    // Skipped under dry run: the cache wrote nothing to read back, and the
    // slice it derives is written by this task rather than by the cache, so it
    // would otherwise be the one write a dry run still performs.
    if (isEightK(form) && primaryDoc.trim().length > 0 && !isDryRun()) {
      try {
        // Same resolution `shouldSkipCached` uses, so the path this writes is
        // the path the next run's skip check looks for.
        const safeName = sanitizePrimaryDoc(resolvePrimaryDocName(primaryDoc) ?? "");
        // The one step that genuinely needs the text. Read it back from the
        // cache: the file is guaranteed present by the check above, and the
        // fetch no longer hands a string over.
        const text = await readFile(requiredPath, "utf-8");
        const sliced = extractPrimaryDocFromSubmission(text, safeName);
        if (sliced !== undefined) {
          const primaryPath = path.join(
            raw,
            accessionDocCacheRelative(cik, accessionNumber, safeName)
          );
          if (force || !existsSync(primaryPath)) {
            // Nothing else writes this one — the slice is derived here, not
            // fetched — so it needs both the eviction and the atomic write.
            if (force && !isDryRun()) {
              await evictCacheFile(primaryPath, cikDir);
            }
            await writeFileAtomic(primaryPath, cikDir, sliced);
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
   * Takes the item so the instance carries a per-instance `title`. The sweep is
   * thousands of instances of one class, and the worker owns each into this
   * task's subgraph, so that title is what labels its row while the filing is
   * in flight. It has to be set HERE rather than passed to `own`: `ensureTask`
   * returns a `Task` as-is, so `own`'s config never reaches one.
   *
   * No `defaults`: `force` arrives on the item handed to `run`.
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
    const formSet = formsForDownloadSet(input.set);

    // The scan never holds more than one page of `filings`, and asks the
    // database for as few of them as it can.
    //
    // Two things do that. The form list goes into the QUERY rather than being
    // applied to rows already in JS — `(form, cik)` is an index, so an `8k` run
    // reads 8-Ks instead of reading a SPAC's whole history and discarding the
    // 10-Qs, 10-Ks and Section 16 forms that dominate it. And the read is a
    // cursor walk, so `everything` — which has no form to narrow by — is
    // bounded by the page size rather than by how much history 900 candidates
    // happen to have.
    //
    // `cik` leads the primary key, so both the `in` filter and the keyset
    // predicate ride `(cik, accession_number)` order: no sort, no offset
    // re-scan, and each page is one indexed range read.
    let matched = 0;
    const todo: CacheOneInput[] = [];
    // Three different situations, kept as three counters: "already have it" is
    // the healthy steady state, "the filing names no document" is an EDGAR
    // shape, and "the name is not path-safe" is a filer-authored value worth
    // looking at. One shared counter said only "nothing happened".
    let skippedCached = 0;
    let skippedNoFileName = 0;
    let skippedUnsafeName = 0;
    const forms = formSet === undefined ? undefined : [...formSet];
    const chunkSize = spacDownloadCikChunkSize(forms?.length ?? 0);
    for (let start = 0; start < ciks.length; start += chunkSize) {
      const chunk = ciks.slice(start, start + chunkSize);
      const criteria: SearchCriteria<Filing> = {
        cik: { value: chunk, operator: "in" },
        ...(forms === undefined ? {} : { form: { value: forms, operator: "in" as const } }),
      };
      let cursor: PageCursor | undefined;
      do {
        if (context.signal?.aborted) throw new TaskAbortedError();
        const page = await filingRepo.queryPage(criteria, {
          limit: SPAC_DOWNLOAD_FILING_PAGE_SIZE,
          cursor,
        });
        for (const row of page.items) {
          const form = row.form ?? "";
          if (form.length === 0) continue;
          // The query already narrowed to these forms; this stays as the guard
          // for `everything`, whose criteria carry no form at all.
          if (formSet !== undefined && !formSet.has(form)) continue;
          matched++;
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
            // `Filing.primary_doc` is nullable; the data port is not. Coalesce
            // once here, at the worklist boundary, exactly as the accession-doc
            // bootstrap does — a nullable does not belong in a task's input port.
            primaryDoc: row.primary_doc ?? "",
            force,
          });
        }
        // Terminate on an empty page as well as on a missing cursor: a defined
        // `nextCursor` does not promise more rows, and a concurrent delete can
        // empty a page mid-walk.
        if (page.items.length === 0) break;
        cursor = page.nextCursor;
      } while (cursor);
    }

    const skips = { skippedCached, skippedNoFileName, skippedUnsafeName };

    if (isDryRun() || todo.length === 0) {
      return { ...emptyResult(candidates.length, matched), ...skips, ...totals(skips) };
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
        // Owned and RUN, never `execute`d directly. Ownership registers the
        // task in this one's subgraph — which is what earns it a progress row,
        // nests its fetch workflow beneath that row instead of beside it, and
        // propagates the registry and abort signal that a bare `execute` call
        // leaves to hand-passing a context. Disowned per item in a `finally`,
        // so a sweep of thousands keeps only the in-flight filings on screen
        // and in the graph.
        const inner = context.own(this.createInnerTask(item));
        let result: CacheOneOutput;
        try {
          result = await inner.run(item);
        } finally {
          context.disown(inner);
        }
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
      matched,
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
  primaryDoc: string | null | undefined
): boolean {
  const requiredPath = path.join(raw, accessionDocCacheRelative(cik, accessionNumber, fileName));
  if (!existsSync(requiredPath)) return false;
  if (!isEightK(form)) return true;
  const primaryName = resolvePrimaryDocName(primaryDoc);
  // No named primary document: the cached full submission is everything this
  // filing has to cache, so it is already complete.
  if (primaryName === undefined) return true;
  try {
    const safeName = sanitizePrimaryDoc(primaryName);
    const primaryPath = path.join(raw, accessionDocCacheRelative(cik, accessionNumber, safeName));
    return existsSync(primaryPath);
  } catch {
    return true;
  }
}
