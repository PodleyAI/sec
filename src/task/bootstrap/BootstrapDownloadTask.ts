/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { SecUserAgent } from "../../config/Constants";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";

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
  const doneDir = join(rawDataFolder, BULK_DONE_DIR);
  mkdirSync(doneDir, { recursive: true });
  writeFileSync(join(doneDir, `${targetFolder}.json`), JSON.stringify(marker, null, 2));
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

/**
 * Streams an HTTP response body directly to disk without buffering the
 * full payload in memory. Returns the byte count written. Honours
 * `signal` and reports progress via `onProgress(downloadedBytes,
 * totalBytes | undefined)`.
 *
 * Exported for testing — the task wraps it with logging and the SEC
 * User-Agent header.
 *
 * When the caller sends a conditional header (`If-None-Match` /
 * `If-Modified-Since`) and the origin answers `304 Not Modified`, this returns
 * `notModified: true` without touching `destPath`. The 304 check must precede
 * both the `response.ok` guard (304 is not "ok") and the body-null guard (a 304
 * legitimately carries no body).
 */
export async function streamDownloadToFile(
  url: string,
  destPath: string,
  opts: {
    readonly headers?: Record<string, string>;
    readonly signal?: AbortSignal;
    readonly onProgress?: (downloadedBytes: number, totalBytes: number | undefined) => void;
  } = {}
): Promise<{
  bytes: number;
  totalBytes: number | undefined;
  notModified: boolean;
  etag: string | undefined;
  lastModified: string | undefined;
}> {
  const response = await fetch(url, {
    headers: opts.headers,
    signal: opts.signal,
  });
  const etag = response.headers.get("etag") ?? undefined;
  const lastModified = response.headers.get("last-modified") ?? undefined;
  if (response.status === 304) {
    return { bytes: 0, totalBytes: undefined, notModified: true, etag, lastModified };
  }
  if (!response.ok) {
    throw new Error(
      `Download failed: HTTP ${response.status} ${response.statusText} for ${url}`
    );
  }
  if (response.body === null) {
    throw new Error(`Download returned no body for ${url}`);
  }

  // Strict integer parse, fail-closed: `parseInt` accepts trailing garbage
  // ("123abc" → 123) which would let a malformed Content-Length defeat the
  // size-mismatch integrity check below. When the header is present we
  // require each comma-separated part to be a pure non-negative integer no
  // larger than `MAX_SAFE_INTEGER` (beyond that point `bytes !== totalBytes`
  // is no longer exact); otherwise we throw rather than silently treating
  // the response as having no advertised length. A truly-absent header
  // (chunked transfer) keeps `totalBytes` undefined and skips the
  // mismatch assertion as before.
  const len = response.headers.get("content-length");
  let totalBytes: number | undefined;
  if (len !== null) {
    // RFC 9112 §6.3: repeated Content-Length lines may be combined as
    // "v1, v2, ...". Equal duplicates are valid (same length); mismatched
    // values are a protocol error. A single value remains a single value.
    const parts = len.split(",").map((p) => p.trim());
    if (parts.length === 0 || parts.some((p) => !/^\d+$/.test(p))) {
      throw new Error(`Invalid Content-Length header ${JSON.stringify(len)} for ${url}`);
    }
    if (new Set(parts).size > 1) {
      throw new Error(
        `Conflicting Content-Length values ${JSON.stringify(len)} for ${url} (RFC 9112 §6.3 requires duplicates to be equal)`
      );
    }
    const parsed = Number(parts[0]);
    if (parsed > Number.MAX_SAFE_INTEGER) {
      throw new Error(`Content-Length ${parts[0]} exceeds MAX_SAFE_INTEGER for ${url}`);
    }
    totalBytes = parsed;
  }

  const writer = Bun.file(destPath).writer();
  let bytes = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let originalError: unknown;
  try {
    reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
      bytes += value.length;
      opts.onProgress?.(bytes, totalBytes);
    }
    await writer.flush();
    if (totalBytes !== undefined && bytes !== totalBytes) {
      throw new Error(
        `Download size mismatch: got ${bytes} bytes, expected ${totalBytes}`
      );
    }
  } catch (err) {
    originalError = err;
  }

  // Release the reader before closing the writer so the underlying
  // stream is cancellable if writer.end() awaits a flush.
  try {
    reader?.releaseLock();
  } catch {
    // swallow
  }

  // Close the writer FIRST, then unlink. On Windows, rmSync cannot
  // delete a file whose handle is still open. On every platform, a
  // writer.end() failure (disk full, permission error) must surface as
  // the operation failure on the success path — silently swallowing it
  // would let us return success with a corrupt / half-flushed file.
  let endError: unknown;
  try {
    await writer.end();
  } catch (e) {
    endError = e;
  }

  // Best-effort cleanup on any failure path (mid-stream abort, size
  // mismatch, writer error, end-flush error) — drop the partial file so
  // a multi-GB stale archive doesn't sit on disk silently. force: true
  // makes this a no-op when the file was never created.
  if (originalError !== undefined || endError !== undefined) {
    try {
      rmSync(destPath, { force: true });
    } catch {
      // swallow — the original error matters more
    }
  }

  if (originalError !== undefined) throw originalError;
  if (endError !== undefined) throw endError;
  return { bytes, totalBytes, notModified: false, etag, lastModified };
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

    // Stream the response body directly to disk via streamDownloadToFile.
    // SEC bulk archives (submissions.zip, companyfacts.zip) are multi-GB;
    // the previous path went through SecFetchJob with response_type:
    // "blob", which buffered the entire body in JS heap and OOM'd on
    // smaller VMs. We bypass the SecFetchJob queue/retry machinery here
    // because workglow's FetchUrlJob materialises the body regardless of
    // response_type. Bulk download is a low-frequency operator-triggered
    // path, so dropping the queue-level retry is an acceptable tradeoff
    // for the memory ceiling. SEC's 10 req/sec rate limit is never a
    // concern for a single download.
    let lastReportedPct = -1;
    let sizeLogged = false;
    const {
      bytes: downloadedBytes,
      totalBytes,
      notModified,
      etag,
      lastModified,
    } = await streamDownloadToFile(input.url, zipPath, {
      headers,
      signal: context.signal,
      onProgress: (downloaded, total) => {
        if (!sizeLogged && total !== undefined) {
          console.log(`Download size: ~${(total / (1024 * 1024)).toFixed(0)} MB`);
          sizeLogged = true;
        }
        if (total !== undefined && total > 0) {
          const pct = Math.floor((downloaded / total) * 100);
          if (pct !== lastReportedPct) {
            context.updateProgress(pct, `${(downloaded / (1024 * 1024)).toFixed(0)} MB`);
            lastReportedPct = pct;
          }
        }
      },
    });

    if (notModified) {
      console.log(
        `${input.targetFolder}: unchanged since ${usableMarker?.extractedAt ?? "the last run"} (HTTP 304) — skipping download and extraction.`
      );
      return { success: true };
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
        contentLength: totalBytes ?? downloadedBytes,
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
