/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

/**
 * EDGAR daily-feed tar members are named for the accession they carry, e.g.
 * `20210305.nc/0001193125-21-066104.nc` or `0001193125-21-066104.nc`, and
 * corrections append a suffix (`…corr01.nc`). The accession-number shape
 * (10-2-6 digits) is specific enough to lift out of any of those.
 */
const ACCESSION_RE = /(\d{10}-\d{2}-\d{6})/;

export interface FeedEntry {
  /** Accession number with dashes, e.g. `0001193125-21-066104`. */
  readonly accession: string;
  /** The full-submission SGML text of the `.nc` member. */
  readonly text: string;
}

/**
 * Pull-based byte reader over an async iterable of chunks. `readExact` returns
 * exactly `n` bytes (buffering as needed) or `null` if the stream ends with
 * fewer than `n` bytes left; `skip` consumes and discards `n` bytes without
 * retaining them, so an unwanted tar member's (potentially large) body never
 * lands in memory.
 */
class ByteReader {
  private readonly iter: AsyncIterator<Uint8Array>;
  private buf: Buffer = Buffer.alloc(0);
  private done = false;

  constructor(src: AsyncIterable<Uint8Array>) {
    this.iter = src[Symbol.asyncIterator]();
  }

  private async fill(): Promise<boolean> {
    if (this.done) return false;
    const { value, done } = await this.iter.next();
    if (done) {
      this.done = true;
      return false;
    }
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    return true;
  }

  async readExact(n: number): Promise<Buffer | null> {
    while (this.buf.length < n) {
      if (!(await this.fill())) return null;
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  async skip(n: number): Promise<void> {
    let remaining = n;
    while (remaining > 0) {
      if (this.buf.length === 0 && !(await this.fill())) return;
      const take = Math.min(remaining, this.buf.length);
      this.buf = this.buf.subarray(take);
      remaining -= take;
    }
  }
}

/** Reads a NUL-terminated ASCII field from a tar header block. */
function headerString(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? length : end).toString("ascii");
}

/**
 * Parses a tar header's size field. Normally octal ASCII (space/NUL padded);
 * GNU tar switches to base-256 (high bit of the first byte set) for values
 * that don't fit in 11 octal digits. A single EDGAR submission never exceeds
 * the octal ceiling, but the base-256 branch keeps the parser correct if one
 * ever does.
 */
function parseTarSize(block: Buffer): number {
  const field = block.subarray(124, 136);
  if (field[0] & 0x80) {
    let value = 0;
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i];
    return value;
  }
  const text = field.toString("ascii").replace(/[\0 ]+$/g, "").trim();
  return text.length === 0 ? 0 : parseInt(text, 8);
}

function isZeroBlock(block: Buffer): boolean {
  for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false;
  return true;
}

/**
 * Streams a gzipped EDGAR daily-feed tarball, decompressing and walking the
 * tar in a single pass. For each regular-file member whose name carries an
 * accession for which `want(accession)` returns true, the member body is
 * buffered and handed to `onEntry`; every other member's data is skipped
 * without buffering. Peak memory is therefore one wanted submission plus the
 * gunzip window — not the whole (multi-GB) day.
 *
 * `body` may be a WHATWG `ReadableStream` (a `fetch` response body) or a Node
 * `Readable`. A source error is forwarded into the gunzip stream so it
 * surfaces as a rejection here rather than hanging.
 */
export async function streamFeedTarball(
  body: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
  want: (accession: string) => boolean,
  onEntry: (entry: FeedEntry) => Promise<void> | void,
  signal?: AbortSignal
): Promise<void> {
  const source =
    typeof (body as ReadableStream).getReader === "function"
      ? // Through `unknown`: the DOM and node:stream/web ReadableStream types
        // no longer overlap under current @types/node, but the runtime object
        // a fetch body provides is exactly what fromWeb consumes.
        Readable.fromWeb(body as unknown as import("node:stream/web").ReadableStream<Uint8Array>)
      : (body as Readable);

  const gunzip = createGunzip();
  source.on("error", (err) => gunzip.destroy(err));
  source.pipe(gunzip);

  const reader = new ByteReader(gunzip as unknown as AsyncIterable<Uint8Array>);

  try {
    let zeroBlocks = 0;
    while (true) {
      if (signal?.aborted) throw new Error("Feed tarball extraction aborted");

      const header = await reader.readExact(512);
      if (header === null) break;

      if (isZeroBlock(header)) {
        // Two consecutive zero blocks mark the end of the archive.
        if (++zeroBlocks >= 2) break;
        continue;
      }
      zeroBlocks = 0;

      const name = headerString(header, 0, 100);
      const prefix = headerString(header, 345, 155);
      const fullName = prefix ? `${prefix}/${name}` : name;
      const size = parseTarSize(header);
      // typeflag '0' (0x30) or NUL (0x00) is a regular file; directories ('5'),
      // GNU long-name entries ('L'), pax headers ('x'/'g'), etc. are skipped.
      const typeflag = header[156];
      const isRegularFile = typeflag === 0x30 || typeflag === 0x00;
      const padding = (512 - (size % 512)) % 512;

      const match = ACCESSION_RE.exec(name) ?? ACCESSION_RE.exec(fullName);
      if (isRegularFile && match && want(match[1])) {
        const data = await reader.readExact(size);
        if (data === null) break; // truncated tail
        await onEntry({ accession: match[1], text: data.toString("utf-8") });
        await reader.skip(padding);
      } else {
        await reader.skip(size + padding);
      }
    }
  } finally {
    // Stop pulling from (and downloading) the source once we're done or on error.
    gunzip.destroy();
    source.destroy();
  }
}

/**
 * Splits a wanted document body out of a full-submission SGML string by exact
 * filename. EDGAR assembles the full submission by concatenating each
 * document's bytes inside a `<DOCUMENT>…<TEXT>…</TEXT></DOCUMENT>` envelope, so
 * the `<TEXT>` inner body of the block whose `<FILENAME>` matches is byte-for-
 * byte the standalone document EDGAR would serve at
 * `…/<accession>/<filename>`.
 *
 * Returns the body only when it can be lifted losslessly: an exact (case-
 * insensitive) `<FILENAME>` match with a text `<TEXT>` body. Binary members
 * (PDF `<PDF>` / uuencoded graphics) are NOT reconstructable from their SGML
 * wrapper, so those return `undefined` and the caller falls back to the network
 * fetch rather than caching a corrupt file.
 */
export function extractPrimaryDocFromSubmission(
  submissionText: string,
  fileName: string
): string | undefined {
  const target = fileName.trim().toLowerCase();
  const re = /<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(submissionText)) !== null) {
    const inner = m[1];
    const docFile = inner.match(/<FILENAME>\s*([^\r\n<]+)/i)?.[1].trim().toLowerCase();
    if (docFile !== target) continue;
    const textMatch = inner.match(/<TEXT>\s*([\s\S]*?)\s*<\/TEXT>/i);
    if (!textMatch) return undefined;
    const bodyBlock = textMatch[1];
    // Reject binary members: their <TEXT> body is a <PDF>/uuencoded envelope,
    // not the raw file, so caching it would silently corrupt the doc cache.
    if (/^\s*<PDF>/i.test(bodyBlock) || /^\s*begin \d{3} /i.test(bodyBlock)) {
      return undefined;
    }
    return bodyBlock;
  }
  return undefined;
}
