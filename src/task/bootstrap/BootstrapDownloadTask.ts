/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { Type } from "typebox";
import type { FetchUrlTaskConfig, FetchUrlTaskOutput, ITask } from "workglow";
import { Dataflow, globalServiceRegistry, IExecuteContext, Task, TaskGraph } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { SecUserAgent } from "../../config/Constants";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { SecFetchTask } from "../fetch/SecFetchTask";
import { ArchiveToFileTask, type ArchiveToFileTaskOutput } from "./ArchiveToFileTask";

export type BootstrapDownloadTaskInput = {
  readonly url: string;
  readonly targetFolder: string;
  /** Re-download and fully overwrite even when the archive is unchanged. */
  readonly force?: boolean;
};

/**
 * What we remember about the last successfully-extracted archive, so a re-run
 * can ask EDGAR "has this changed?" instead of re-pulling ~1.5 GB. Mirrors the
 * `accessiondocs/.feed-done/` marker idiom used by `BootstrapAccessionDocsTask`.
 */
export type BulkArchiveMarker = {
  readonly url: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly contentLength?: number;
  readonly extractedAt: string;
};

/** Directory holding the per-archive markers, under SEC_RAW_DATA_FOLDER. */
export const BULK_DONE_DIR = ".bulk-done";

/**
 * Reads the marker for `targetFolder`, or undefined when absent/corrupt. A
 * corrupt marker is treated as "no marker" rather than an error: the worst
 * case is one redundant download, whereas throwing would wedge the pipeline.
 */
export function readBulkArchiveMarker(
  rawDataFolder: string,
  targetFolder: string
): BulkArchiveMarker | undefined {
  const markerPath = join(rawDataFolder, BULK_DONE_DIR, `${targetFolder}.json`);
  if (!existsSync(markerPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(markerPath, "utf8")) as BulkArchiveMarker;
    if (typeof parsed?.url !== "string") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeBulkArchiveMarker(
  rawDataFolder: string,
  targetFolder: string,
  marker: BulkArchiveMarker
): void {
  const markerPath = join(rawDataFolder, BULK_DONE_DIR, `${targetFolder}.json`);
  // `dirname`, not the marker root: a nested target folder (`adv/2026-07`)
  // puts the marker a level down, and only the root would exist.
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify(marker, null, 2));
}

/**
 * True when the marker can be trusted to mean "the extracted tree is already
 * present and current". A marker whose URL no longer matches is stale, and a
 * marker whose target directory has since been emptied or deleted would
 * otherwise make us skip a download we genuinely need.
 */
export function markerCoversTarget(
  marker: BulkArchiveMarker | undefined,
  url: string,
  targetDir: string
): boolean {
  if (marker === undefined || marker.url !== url) return false;
  if (!existsSync(targetDir)) return false;
  try {
    return readdirSync(targetDir).length > 0;
  } catch {
    return false;
  }
}

/** Response facts the marker bookkeeping needs, lifted off the fetch task's output. */
interface ArchiveResponse {
  readonly bytes: number;
  /** False when the body carried no bytes, so `destPath` was never touched. */
  readonly wrote: boolean;
  readonly notModified: boolean;
  readonly etag: string | undefined;
  readonly lastModified: string | undefined;
}

/**
 * `name` must be lower-case. The fetch task builds `metadata.headers` by
 * iterating a `Headers`, which the Fetch standard lower-cases, so the direct
 * hit answers; the scan is the fallback for a runtime that does not.
 */
function headerOf(metadata: FetchUrlTaskOutput["metadata"], name: string): string | undefined {
  const headers = metadata?.headers as Record<string, string> | undefined;
  if (!headers) return undefined;
  return headers[name] ?? Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}

export type BootstrapDownloadTaskOutput = {
  readonly success: boolean;
};

/**
 * Task that downloads a bulk SEC ZIP archive and extracts it to SEC_RAW_DATA_FOLDER.
 */
export class BootstrapDownloadTask extends Task<
  BootstrapDownloadTaskInput,
  BootstrapDownloadTaskOutput
> {
  static readonly type = "BootstrapDownloadTask";
  static readonly category = "SEC";
  static readonly title = "Download bulk archive";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      url: Type.String(),
      targetFolder: Type.String(),
      force: Type.Optional(Type.Boolean()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  /**
   * The archive's byte producer. A protected seam so the marker / extraction
   * bookkeeping is testable without the network; production returns the real
   * rate-limited fetch.
   *
   * `SecFetchTask` installs no output cache (only `SecCachedFetchTask` does),
   * which is what satisfies FetchUrlTask's refusal to combine a conditional
   * request with one: a 304 carries no body, so caching the response would
   * write an empty row over the copy the 304 just certified as current.
   */
  protected createArchiveFetchTask(url: string, headers: Record<string, string>): ITask {
    return new SecFetchTask({ url, headers, response_type: "stream" }, {
      title: "Download archive",
    } as FetchUrlTaskConfig);
  }

  /**
   * Downloads `url` to `destPath` as a two-node subgraph — the fetch produces
   * `body`, {@link ArchiveToFileTask} consumes it — so a multi-GB archive
   * never exists in memory as one value. Replaces a raw `fetch()` bypass, so
   * the biggest download sec performs regains SafeFetch's redirect checks, the
   * SEC rate limiter, SecFetchJob's retry/backoff and 429 throttle signalling.
   *
   * `Content-Length` verification is not reimplemented here: FetchUrlTask
   * asserts the advertised length at end of stream, which is the only evidence
   * available that a body which ended without a socket error was complete.
   */
  private async downloadArchive(
    url: string,
    destPath: string,
    headers: Record<string, string>,
    context: IExecuteContext,
    onProgress: (bytes: number) => void
  ): Promise<ArchiveResponse> {
    const fetchTask = this.createArchiveFetchTask(url, headers);
    const sink = new ArchiveToFileTask({ defaults: { destPath }, title: "Write archive" });
    sink.onProgress = onProgress;

    const graph = context.own(new TaskGraph(), { title: "Download archive" });
    graph.addTask(fetchTask);
    graph.addTask(sink);
    graph.addDataflow(new Dataflow(fetchTask.config.id, "body", sink.config.id, "body"));

    try {
      // Without `noAccumulation` the edge is drained to a value before the
      // sink starts — the whole multi-GB archive in memory, which is the
      // failure this replaced.
      await graph.run(
        {},
        { noAccumulation: true, accumulateLeafOutputs: false, parentSignal: context.signal }
      );
    } finally {
      context.disown(graph);
    }

    // Read the response facts off the producer rather than wiring a second
    // `metadata` edge: the sink runs CONCURRENTLY with the fetch, so a value
    // edge from the same producer would have it waiting for an output the
    // producer cannot finish until the sink has drained it.
    const metadata = (fetchTask.runOutputData as FetchUrlTaskOutput).metadata;
    const written = sink.runOutputData as Partial<ArchiveToFileTaskOutput>;
    return {
      bytes: written.bytes ?? 0,
      wrote: written.wrote === true,
      notModified: metadata?.notModified === true,
      etag: headerOf(metadata, "etag"),
      lastModified: headerOf(metadata, "last-modified"),
    };
  }

  async execute(
    input: BootstrapDownloadTaskInput,
    context: IExecuteContext
  ): Promise<BootstrapDownloadTaskOutput> {
    const dryRun = isDryRun();

    const rawDataFolder = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const targetDir = resolve(rawDataFolder, input.targetFolder);

    // Ensure targetDir is within rawDataFolder to prevent path traversal
    const safeBase = resolve(rawDataFolder) + sep;
    if (!targetDir.startsWith(safeBase)) {
      throw new Error(
        `Invalid targetFolder "${input.targetFolder}": must resolve to a subdirectory of SEC_RAW_DATA_FOLDER`
      );
    }

    const force = input.force ?? false;

    if (dryRun) {
      console.log(`Would download ${input.url} to ${targetDir}${force ? " (forced)" : ""}`);
      return { success: true };
    }

    mkdirSync(targetDir, { recursive: true });

    const zipPath = join(rawDataFolder, `${input.targetFolder}.zip`);

    // Conditional fetch: when a previous run recorded the archive's validators
    // AND the extracted tree is still on disk, ask EDGAR whether anything has
    // changed instead of re-pulling ~1.5 GB. SEC serves both ETag and
    // Last-Modified on the bulk archives. `--force` skips this entirely.
    const marker = force ? undefined : readBulkArchiveMarker(rawDataFolder, input.targetFolder);
    const usableMarker = markerCoversTarget(marker, input.url, targetDir) ? marker : undefined;

    // Send BOTH validators when we have them. www.sec.gov serves an ETag but
    // ignores `If-None-Match` (answers 200 with the full body); it honours
    // `If-Modified-Since` and answers 304. Preferring the ETag — the usual
    // choice, since RFC 9110 has a server evaluate If-None-Match and ignore
    // If-Modified-Since when both are present — silently disables the skip
    // against the one origin this exists for. Sending both costs nothing and
    // works whichever validator a host actually implements.
    const headers: Record<string, string> = { "User-Agent": SecUserAgent };
    if (usableMarker?.etag !== undefined) {
      headers["If-None-Match"] = usableMarker.etag;
    }
    if (usableMarker?.lastModified !== undefined) {
      headers["If-Modified-Since"] = usableMarker.lastModified;
    }

    console.log(`Downloading ${input.url} ...`);

    // SEC bulk archives (submissions.zip, companyfacts.zip) are multi-GB, so
    // this streams to disk via a producer rather than FetchUrlTask, which
    // materializes the whole body regardless of response_type. Streaming
    // keeps the rate limiter, the retry/backoff and the 429 throttle signal
    // intact instead of trading them away for a raw fetch().
    let lastReportedMb = -1;
    const response = await this.downloadArchive(
      input.url,
      zipPath,
      headers,
      context,
      (downloaded) => {
        // The advertised total is verified inside the fetch task rather than
        // reported here, so progress is stated in MB rather than as a
        // percentage of a number this side no longer holds.
        const mb = Math.floor(downloaded / (1024 * 1024));
        if (mb !== lastReportedMb) {
          context.updateProgress(0, `${mb} MB`);
          lastReportedMb = mb;
        }
      }
    );
    const { bytes: downloadedBytes, wrote, notModified, etag, lastModified } = response;

    if (notModified) {
      console.log(
        `${input.targetFolder}: unchanged since ${usableMarker?.extractedAt ?? "the last run"} (HTTP 304) — skipping download and extraction.`
      );
      return { success: true };
    }

    // The sink reports `wrote: false` when the body carried no bytes, which
    // outside a 304 means the origin answered with nothing. Staging never
    // happened, so anything sitting at `zipPath` is an earlier run's archive —
    // extracting it would republish stale content AND stamp the marker with
    // this response's validators, making the staleness permanent.
    if (!wrote) {
      throw new Error(
        `Download of ${input.url} produced no body (${downloadedBytes} bytes, not a 304) — ` +
          `refusing to extract, since nothing was staged at ${zipPath}.`
      );
    }

    // Belt-and-braces: some intermediaries drop conditional headers and answer
    // 200 with a byte-identical archive. If the validators still match what we
    // extracted last time, the freshly-staged zip is redundant — bin it rather
    // than re-extracting ~1M files over identical content.
    if (
      usableMarker !== undefined &&
      etag !== undefined &&
      usableMarker.etag === etag &&
      usableMarker.contentLength === downloadedBytes
    ) {
      rmSync(zipPath, { force: true });
      console.log(
        `${input.targetFolder}: unchanged since ${usableMarker.extractedAt} (matching ETag) — skipping extraction.`
      );
      return { success: true };
    }

    console.log(`Download complete (${downloadedBytes} bytes). Extracting to ${targetDir} ...`);

    const unzipPath = Bun.which("unzip");
    if (!unzipPath) {
      throw new Error(
        `The "unzip" binary was not found. Please install it (e.g., "apt install unzip" on Debian/Ubuntu or "brew install unzip" on macOS) and try again.`
      );
    }

    // "-uo" extracts only members that are new or newer than their on-disk
    // copy, so an archive that changed in a handful of companies rewrites a
    // handful of files rather than ~1M. The "-o" half suppresses the overwrite
    // prompt, which matters because a prompt in a spawned process would block
    // forever with no tty. "--force" reverts to a full "-o" clobber.
    const unzipFlags = force ? "-o" : "-uo";

    try {
      const proc = Bun.spawn([unzipPath, unzipFlags, zipPath, "-d", targetDir], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        throw new Error(`unzip exited with code ${exitCode}`);
      }

      // Record validators only after a clean extraction, so a crash mid-unzip
      // re-downloads next run instead of falsely reporting the tree as current.
      writeBulkArchiveMarker(rawDataFolder, input.targetFolder, {
        url: input.url,
        etag,
        lastModified,
        // The bytes actually written, which the fetch task has already
        // asserted against the advertised Content-Length.
        contentLength: downloadedBytes,
        extractedAt: new Date().toISOString(),
      });
    } finally {
      // Always remove the staged zip — on extract failure the partial
      // archive can be many GB and would silently leak into rawDataFolder
      // until the next bootstrap run. force: true makes the cleanup a
      // no-op if the file is already gone (e.g. Bun.spawn never created
      // anything we own).
      rmSync(zipPath, { force: true });
    }
    console.log(`Extraction complete. Cleaned up ${zipPath}`);

    return { success: true };
  }
}
