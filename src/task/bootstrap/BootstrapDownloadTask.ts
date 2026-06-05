/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { SecUserAgent } from "../../config/Constants";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";

export type BootstrapDownloadTaskInput = {
  readonly url: string;
  readonly targetFolder: string;
};

/**
 * Streams an HTTP response body directly to disk without buffering the
 * full payload in memory. Returns the byte count written. Honours
 * `signal` and reports progress via `onProgress(downloadedBytes,
 * totalBytes | undefined)`.
 *
 * Exported for testing — the task wraps it with logging and the SEC
 * User-Agent header.
 */
export async function streamDownloadToFile(
  url: string,
  destPath: string,
  opts: {
    readonly headers?: Record<string, string>;
    readonly signal?: AbortSignal;
    readonly onProgress?: (downloadedBytes: number, totalBytes: number | undefined) => void;
  } = {}
): Promise<{ bytes: number; totalBytes: number | undefined }> {
  const response = await fetch(url, {
    headers: opts.headers,
    signal: opts.signal,
  });
  if (!response.ok) {
    throw new Error(
      `Download failed: HTTP ${response.status} ${response.statusText} for ${url}`
    );
  }
  if (response.body === null) {
    throw new Error(`Download returned no body for ${url}`);
  }

  // Strict integer parse: `parseInt` accepts trailing garbage ("123abc" →
  // 123) which would let a malformed Content-Length defeat the
  // size-mismatch integrity check below. We require the trimmed header
  // to be a pure non-negative integer string, otherwise we fall back to
  // `undefined` (the no-Content-Length path), which still streams to
  // completion but skips the mismatch assertion. Values above
  // `MAX_SAFE_INTEGER` (extremely unlikely in practice) are also clamped
  // to `undefined` because beyond that point arithmetic on
  // `bytes !== totalBytes` is no longer exact.
  const len = response.headers.get("content-length");
  const parsedTotal =
    len !== null && /^\d+$/.test(len.trim()) ? Number(len.trim()) : undefined;
  const totalBytes =
    parsedTotal !== undefined && parsedTotal <= Number.MAX_SAFE_INTEGER
      ? parsedTotal
      : undefined;

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
  return { bytes, totalBytes };
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

    if (dryRun) {
      console.log(`Would download ${input.url} to ${targetDir}`);
      return { success: true };
    }

    mkdirSync(targetDir, { recursive: true });

    const zipPath = join(rawDataFolder, `${input.targetFolder}.zip`);

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
    const { bytes: downloadedBytes } = await streamDownloadToFile(input.url, zipPath, {
      headers: { "User-Agent": SecUserAgent },
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
    console.log(`Download complete (${downloadedBytes} bytes). Extracting to ${targetDir} ...`);

    const unzipPath = Bun.which("unzip");
    if (!unzipPath) {
      throw new Error(
        `The "unzip" binary was not found. Please install it (e.g., "apt install unzip" on Debian/Ubuntu or "brew install unzip" on macOS) and try again.`
      );
    }

    try {
      const proc = Bun.spawn([unzipPath, "-o", zipPath, "-d", targetDir], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        throw new Error(`unzip exited with code ${exitCode}`);
      }
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
