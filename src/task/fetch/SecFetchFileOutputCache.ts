/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CacheRef, StreamMode } from "workglow";
import {
  FetchUrlTaskOutput,
  isCacheRef,
  makeCacheRef,
  TaskInput,
  TaskOutput,
  TaskOutputRepository,
} from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { tmpPathFor, writeFully } from "../../util/atomicFileWrite";
import { secDate, YYYYdMMdDD } from "../../util/parseDate";

/**
 * Resolves `relative` against `folderPath` and asserts the result stays
 * inside `folderPath`. Defends every cache call site against a stray
 * `inputToFileName` returning a path with `..` segments or an absolute
 * path — SEC-supplied fields (`primary_doc` filenames, accession numbers)
 * flow into these paths, and a single malformed value would let a fetch
 * write outside SEC_RAW_DATA_FOLDER. Returns the resolved absolute path.
 */
function safeJoinWithinFolder(folderPath: string, relative: string): string {
  const base = path.resolve(folderPath);
  const candidate = path.resolve(base, relative);
  // `path.relative` returns a path starting with a parent-segment (`..`)
  // ONLY when the candidate escapes the base — a legitimate file named
  // "..foo.txt" returns "..foo.txt" too, so a plain `startsWith("..")`
  // would false-positive on it. Anchor on the path separator (and the
  // exact ".." case) instead, and also reject absolute paths.
  const rel = path.relative(base, candidate);
  const escapes =
    rel === ".." ||
    rel.startsWith(".." + path.sep) ||
    rel.startsWith("../") || // posix sep on win32 hosts (just in case)
    path.isAbsolute(rel);
  if (escapes) {
    throw new Error(
      `Refusing to access path outside cache folder: "${relative}" resolved to "${candidate}", outside "${base}".`
    );
  }
  return candidate;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

interface SecFetchFileOutputCacheOptions {
  folderPath: string;
  outputCompression?: boolean;
  inputToFileName: (input: any) => string;
  outputSerializer?: (output: FetchUrlTaskOutput) => string | Blob;
  outputDeserializer?: (output: string | Blob) => FetchUrlTaskOutput;
  response_type?: string;
}

export class SecFetchFileOutputCache extends TaskOutputRepository {
  private folderPath: string;
  private inputToFileName: (input: any) => string;

  constructor({ folderPath, outputCompression, inputToFileName }: SecFetchFileOutputCacheOptions) {
    super({ outputCompression });
    this.folderPath = path.join(folderPath);
    this.inputToFileName = inputToFileName;
    mkdirSync(this.folderPath, { recursive: true });
  }

  /**
   * Streaming counterpart of {@link saveOutput}, and the probe
   * `supportsStreaming()` keys on. Writes the bytes to the same path
   * {@link inputToFileName} yields for a materializing fetch of the same
   * document, so `sec spac download`'s `"stream"` fill and a later `"text"`
   * read address one cache entry — and the streamed copy is the more faithful
   * of the two, being the origin's bytes rather than a UTF-8 re-encode.
   *
   * Keeps saveOutput's tmp-then-rename discipline: a stream that errors
   * mid-body must not rename a truncated file into place, where the next run
   * would read the stump as a complete document with nothing marking it short.
   */
  async saveOutputStreamPort(
    taskType: string,
    inputs: TaskInput,
    port: string,
    mode: StreamMode,
    chunks: AsyncIterable<Uint8Array>,
    _metadata: Record<string, unknown>
  ): Promise<CacheRef> {
    const filePath = safeJoinWithinFolder(this.folderPath, this.inputToFileName(inputs));
    if (isDryRun()) {
      // No bytes are written, but the stream must still be drained: the
      // producer is blocked on backpressure until someone reads it, and an
      // abandoned fetch body would hang the run rather than no-op it.
      let dryBytes = 0;
      for await (const chunk of chunks) dryBytes += chunk.byteLength;
      return makeCacheRef({ $ref: filePath, port, mode, size: dryBytes });
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = tmpPathFor(filePath);

    let size = 0;
    // `fs/promises` rather than `Bun.file().writer()`: this repo's tests run
    // under vitest on Node, where the Bun global does not exist.
    const handle = await open(tmpPath, "w");
    try {
      for await (const chunk of chunks) {
        size += await writeFully(handle, chunk);
      }
      await handle.close();
      await rename(tmpPath, filePath);
    } catch (error) {
      // Close before unlinking: on Windows a file with a live handle cannot be
      // deleted, and a failed close must not mask the stream error.
      await handle.close().catch(() => undefined);
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }
    this.emit("output_saved", taskType);
    return makeCacheRef({ $ref: filePath, port, mode, size });
  }

  /**
   * Reader counterpart of {@link saveOutputStreamPort}: resolves a ref this
   * repo minted back to its bytes, so the runner can rehydrate a below-
   * threshold body into an inline value.
   */
  async getOutputByRef(ref: CacheRef): Promise<Blob | undefined> {
    const target = safeJoinWithinFolder(this.folderPath, path.relative(this.folderPath, ref.$ref));
    try {
      return new Blob([await readFile(target)]);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  outputSerializer(output: FetchUrlTaskOutput, response_type: string): any {
    if (response_type === "json") {
      return JSON.stringify(output.json);
    } else if (response_type === "text") {
      return output.text;
    } else if (response_type === "blob") {
      // writeFile cannot consume a Blob directly; convert to a Buffer.
      return output.blob;
    } else if (response_type === "arraybuffer") {
      // Binary payload (e.g. a downloaded ZIP archive). Buffer.from views the
      // ArrayBuffer without copying; saveOutput writes it in binary mode.
      return output.arraybuffer ? Buffer.from(output.arraybuffer as ArrayBuffer) : Buffer.alloc(0);
    } else {
      console.warn(`Unknown response type: ${response_type}, assuming text`);
      return output.text;
    }
  }

  outputDeserializer(data: any, response_type: string): FetchUrlTaskOutput | undefined {
    if (response_type === "stream") {
      // A "stream" fetch materializes no derived port — the file on disk IS
      // the result and callers read it by path. The entry exists, so this is a
      // hit carrying nothing, not a miss.
      return {};
    }
    const result: FetchUrlTaskOutput = {};
    if (response_type === "json") {
      result.json = JSON.parse(data as string);
    }
    if (response_type === "text") {
      result.text = data.toString();
    }
    if (response_type === "blob") {
      // readFile returns a Buffer; wrap it back into a Blob so downstream
      // consumers see the same shape they wrote.
      result.blob = data instanceof Blob ? data : new Blob([data]);
    }
    if (response_type === "arraybuffer") {
      // readFile returns a Buffer; hand back exactly its bytes as an ArrayBuffer
      // (slicing off any pooled-buffer slack) so downstream sees what was written.
      const buf = data as Buffer;
      result.arraybuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    if (Object.keys(result).length === 0) {
      // An unrecognized response_type filled no field. Handing back the empty
      // object made getOutput report a cache HIT holding nothing, which reads
      // downstream as "the document was empty" rather than "no entry" — the
      // fetch is then skipped and the caller parses nothing.
      return undefined;
    }
    return result;
  }

  /**
   * Saves a task output to the repository
   * @param taskType The type of task to save the output for
   * @param input The input parameters for the task
   * @param output The task output to save
   */
  async saveOutput(taskType: string, input: TaskInput, output: TaskOutput): Promise<void> {
    if (isDryRun()) {
      return;
    }
    const responseType = input.response_type as string;
    const filePath = safeJoinWithinFolder(this.folderPath, this.inputToFileName(input));

    // The row save runs after the streaming sink, and both target this one
    // path — so re-serializing here would overwrite the bytes the sink just
    // committed. For "stream" there is no derived value to write at all and
    // the overwrite would be an empty file; for the materializing types it
    // would replace the origin's bytes with a re-encode of the value derived
    // from them. Either way the streamed copy is the artifact, and the file
    // the sink renamed into place is already the entry a later getOutput
    // reads. `body` carrying a CacheRef is the evidence the sink ran.
    if (responseType === "stream" || isCacheRef((output as FetchUrlTaskOutput).body)) {
      this.emit("output_saved", taskType);
      return;
    }

    await mkdir(path.dirname(filePath), { recursive: true });

    // Write to a unique tmp file then atomically rename so an interrupted
    // write never produces a truncated cache entry, and so two concurrent
    // writers cannot interleave bytes targeting the same key.
    const tmpPath = tmpPathFor(filePath);
    const isBinary = responseType === "blob" || responseType === "arraybuffer";
    let serialized = this.outputSerializer(output, responseType);
    if (responseType === "blob" && serialized instanceof Blob) {
      serialized = Buffer.from(await serialized.arrayBuffer());
    }
    try {
      await writeFile(tmpPath, serialized, {
        encoding: isBinary ? "binary" : "utf-8",
      });
      await rename(tmpPath, filePath);
    } catch (error) {
      // best-effort cleanup; ignore if the tmp file was never created
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }
    this.emit("output_saved", taskType);
  }

  /**
   * Retrieves a task output from the repository
   * @param taskType The type of task to retrieve the output for
   * @param inputs The input parameters for the task
   * @returns The retrieved task output, or undefined if not found
   */
  async getOutput(
    taskType: string,
    inputs: TaskInput & { date?: YYYYdMMdDD }
  ): Promise<TaskOutput | undefined> {
    const filePath = safeJoinWithinFolder(this.folderPath, this.inputToFileName(inputs));
    try {
      if (inputs.date) {
        const stats = await stat(filePath);
        // The cache entry is fresh only if it was written on or after the
        // input date; older mtimes mean SEC may have published newer data
        // since the entry was cached.
        const fileDate = secDate(new Date(stats.mtime));
        const inputDate = secDate(inputs.date);
        if (fileDate < inputDate) {
          return undefined;
        }
      }

      // `outputDeserializer` answers `{}` for a stream without looking at the
      // bytes, so reading them would pull an arbitrarily large document into
      // memory only to discard it — the one thing this response type exists to
      // avoid. `stat` settles the only remaining question (is the entry there),
      // and raises the same ENOENT miss the read would have.
      if ((inputs.response_type as string) === "stream") {
        await stat(filePath);
        this.emit("output_retrieved", taskType);
        return {};
      }

      const data = await readFile(filePath);
      if (data) {
        const deserialized = this.outputDeserializer(data, inputs.response_type as string);
        if (deserialized === undefined) return undefined;
        this.emit("output_retrieved", taskType);
        return deserialized;
      }
    } catch (error) {
      // ENOENT is the expected "cache miss" path; surface anything else so
      // permission/disk/format errors aren't silently swallowed.
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
    return undefined;
  }

  async clear(): Promise<void> {
    this.emit("output_cleared");
  }

  async size(): Promise<number> {
    return 0;
  }

  async clearOlderThan(olderThanInMs: number): Promise<void> {
    return undefined;
  }

  isDurable(): boolean {
    return true;
  }
}
