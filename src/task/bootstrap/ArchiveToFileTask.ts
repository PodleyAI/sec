/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { DataPortSchema, IExecuteContext, StreamEvent } from "workglow";
import { Task } from "workglow";
import type { TaskPorts } from "../taskPorts";
import { byteIterableFromEvents } from "./streamEventBytes";

export interface ArchiveToFileTaskInput {
  /** Streaming port: the archive's bytes, as they arrive. */
  readonly body?: unknown;
  readonly destPath?: string;
}

export interface ArchiveToFileTaskOutput {
  readonly bytes: number;
  /** False when the body carried no bytes at all, in which case `destPath` was never touched. */
  readonly wrote: boolean;
}

const inputSchema = {
  type: "object",
  properties: {
    body: { title: "Body", description: "Archive bytes", "x-stream": "binary" },
    destPath: { type: "string", title: "Destination path" },
  },
  required: ["destPath"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    bytes: { type: "number", title: "Bytes" },
    wrote: { type: "boolean", title: "Wrote" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Streams an archive body to a file. A pure sink: it returns a small summary
 * and never a stream, so a multi-GB `submissions.zip` reaches disk without ever
 * existing in memory as one value.
 *
 * Writes through a tmp path and renames, so an interrupted download never
 * leaves a truncated archive where a complete one is expected — the next run
 * would otherwise hand the stump to `unzip` and read the failure as a corrupt
 * source rather than a partial one.
 *
 * The tmp file is opened **lazily, on the first byte**. That is what makes a
 * `304 Not Modified` safe: it carries no body, so nothing is opened and the
 * copy on disk — the one the conditional request just certified as current —
 * is left exactly as it was. Opening up front would truncate it to zero before
 * discovering there was nothing to write. A 200 with a genuinely empty body
 * takes the same path and is reported as `wrote: false`; keeping the existing
 * file is the safer reading of "the origin sent nothing", and no EDGAR bulk
 * archive is empty.
 */
export class ArchiveToFileTask extends Task<
  TaskPorts<ArchiveToFileTaskInput>,
  TaskPorts<ArchiveToFileTaskOutput>
> {
  static readonly type = "ArchiveToFileTask";
  static readonly category = "SEC";
  static readonly title = "Write archive to file";
  static readonly cacheable = false;

  public static inputSchema(): DataPortSchema {
    return inputSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema;
  }

  /** Reports bytes written so far, for the download progress line. */
  public onProgress: (bytes: number) => void = () => {};

  async *executeStream(
    input: ArchiveToFileTaskInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<ArchiveToFileTaskOutput>> {
    const destPath = input.destPath;
    if (destPath === undefined || destPath.length === 0) {
      throw new Error("ArchiveToFileTask requires a destPath");
    }
    const events = context.inputStreams?.get("body");
    if (!events) {
      // Two very different reasons the port can have no live stream, and they
      // must not be conflated. A producer that emitted no byte creates no
      // stream at all — which is exactly what a 304 is — so there is nothing
      // to write and `destPath` is left alone. But a `body` that arrived as a
      // VALUE means the edge was materialized into memory, which for a
      // multi-GB archive is the entire cost this path exists to avoid; that
      // one fails loudly rather than quietly writing the buffer it was handed.
      if (input.body !== undefined) {
        throw new Error(
          "ArchiveToFileTask received a materialized body — the edge did not run as a stream"
        );
      }
      yield { type: "finish", data: { bytes: 0, wrote: false } };
      return;
    }

    const tmpPath = `${destPath}.tmp.${process.pid}.${Date.now().toString(36)}`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let bytes = 0;
    try {
      for await (const chunk of byteIterableFromEvents(events, "body")) {
        if (handle === undefined) {
          await mkdir(path.dirname(tmpPath), { recursive: true });
          handle = await open(tmpPath, "w");
        }
        await handle.write(chunk);
        bytes += chunk.byteLength;
        this.onProgress(bytes);
      }
      if (handle === undefined) {
        yield { type: "finish", data: { bytes: 0, wrote: false } };
        return;
      }
      await handle.close();
      handle = undefined;
      await rename(tmpPath, destPath);
    } catch (error) {
      // Close before unlinking: on Windows a file with a live handle cannot be
      // deleted, and a failed close must not mask the stream error.
      await handle?.close().catch(() => undefined);
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }

    yield { type: "finish", data: { bytes, wrote: true } };
  }

  async execute(): Promise<ArchiveToFileTaskOutput> {
    throw new Error("ArchiveToFileTask only runs as a stream consumer");
  }
}
