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
  readonly skipped: number;
  readonly downloaded: number;
  readonly failed: number;
};

type CacheOneInput = {
  readonly cik: number;
  readonly accessionNumber: string;
  readonly form: string;
  readonly fileName: string;
  readonly primaryDoc: string;
  readonly force?: boolean;
};

type CacheOneOutput = {
  readonly success: boolean;
};

function isEightK(form: string): boolean {
  return form === "8-K" || form === "8-K/A";
}

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
  const tmpPath = `${fullPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
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
 * atomic writer. Same semantics as `sec bootstrap download-docs --force`.
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
let warnedNonAtomicFallback = false;
function warnNonAtomicFallbackOnce(): void {
  if (warnedNonAtomicFallback) return;
  warnedNonAtomicFallback = true;
  console.warn(
    "SPAC doc download: the fetch left no cache file, writing it directly. " +
      "In production this means SEC_RAW_DATA_FOLDER was not registered when the fetch task was built."
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
    return Type.Object({ success: Type.Boolean() });
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
    await context.updateProgress(0, `${form} ${accessionNumber}`);

    if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
      throw new TaskError("SEC_RAW_DATA_FOLDER is not configured");
    }
    const raw = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const cikDir = path.join(raw, "accessiondocs", String(cik).padStart(10, "0"));
    const requiredPath = path.join(raw, accessionDocCacheRelative(cik, accessionNumber, fileName));

    let text: string;
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
    if (cacheReadable) {
      text = await readFile(requiredPath, "utf-8");
    } else {
      if (force && !isDryRun()) {
        // Evict BEFORE fetching: the fetch task's own file cache keys off this
        // exact path, so a surviving entry short-circuits the re-fetch.
        await evictCacheFile(requiredPath, cikDir);
      }
      try {
        text = await this.fetchDoc(cik, accessionNumber, fileName, context);
      } catch (err) {
        if (err instanceof TaskAbortedError) throw err;
        if (context.signal?.aborted) throw new TaskAbortedError();
        return { success: false };
      }
      // The production fetch path already persisted the body through
      // `SecFetchFileOutputCache.saveOutput` (tmp + rename). Writing again on
      // top of that is a second, non-atomic write of bytes that are already on
      // disk. This fallback covers the two cases where nothing wrote: the test
      // seam that stubs `fetchDoc`, and a process where SEC_RAW_DATA_FOLDER was
      // not yet registered when the fetch task was constructed (no output cache
      // is installed then) — which in production means a mis-ordered DI
      // registration, hence the warning.
      if (!existsSync(requiredPath)) {
        warnNonAtomicFallbackOnce();
        await writeFileAtomic(requiredPath, cikDir, text);
      }
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
      downloaded: Type.Integer(),
      failed: Type.Integer(),
    });
  }

  /** Test seam: subclass and return a CacheOne that stubs {@link CacheOneSpacCandidateDocTask.fetchDoc}. */
  protected createInnerTask(force: boolean): CacheOneSpacCandidateDocTask {
    return new CacheOneSpacCandidateDocTask({ defaults: { force } });
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
      throw new TaskError(
        "No SPAC candidates in the requested confidence tier(s). Run `sec update spacs` first."
      );
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
    let skipped = 0;
    for (const row of matchedRows) {
      const form = row.form ?? "";
      const fileName = spacDocFetchFileName(form, row.accession_number, row.primary_doc);
      if (fileName.trim().length === 0) {
        skipped++;
        continue;
      }
      try {
        sanitizePrimaryDoc(fileName);
      } catch {
        skipped++;
        continue;
      }
      if (!force && shouldSkipCached(raw, row.cik, row.accession_number, form, fileName, row.primary_doc)) {
        skipped++;
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

    const empty: DownloadSpacCandidateDocsTaskOutput = {
      candidates: candidates.length,
      matched: matchedRows.length,
      skipped,
      downloaded: 0,
      failed: 0,
    };

    if (isDryRun() || todo.length === 0) {
      return empty;
    }

    let downloaded = 0;
    let failed = 0;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        if (context.signal?.aborted) throw new TaskAbortedError();
        const i = next++;
        if (i >= todo.length) return;
        const item = todo[i];
        const inner = this.createInnerTask(force);
        const result = await inner.execute(item, context);
        if (result.success) downloaded++;
        else failed++;
      }
    };
    const n = Math.min(FORMS_SWEEP_CONCURRENCY_LIMIT, todo.length);
    await Promise.all(Array.from({ length: n }, () => worker()));

    return {
      candidates: candidates.length,
      matched: matchedRows.length,
      skipped,
      downloaded,
      failed,
    };
  }
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
