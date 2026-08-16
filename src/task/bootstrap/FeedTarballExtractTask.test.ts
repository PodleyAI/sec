/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  Dataflow,
  Task,
  TaskGraph,
  type DataPortSchema,
  type IExecuteContext,
  type StreamEvent,
} from "workglow";
import type { TaskPorts } from "../taskPorts";
import type { FeedFiling } from "./feedFilings";
import { FeedTarballExtractTask } from "./FeedTarballExtractTask";

// --- Minimal tar.gz builder (shared shape with feedTarball.test.ts) ---------

function tarHeader(name: string, size: number): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, "ascii");
  h.write("0000644\0", 100, "ascii");
  h.write("0000000\0", 108, "ascii");
  h.write("0000000\0", 116, "ascii");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  h.write("00000000000\0", 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write("0", 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

function makeTarGz(entries: ReadonlyArray<{ name: string; body: string }>): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.from(e.body, "utf-8");
    parts.push(tarHeader(e.name, body.length));
    parts.push(body);
    const pad = (512 - (body.length % 512)) % 512;
    if (pad > 0) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

const FIRST = "0001193125-21-066104";

function filing(accession: string): FeedFiling {
  return { cik: 1, accession_number: accession, form: "8-K", primary_doc: "" } as FeedFiling;
}

/** A tarball whose first member is wanted, followed by enough filler to span many chunks. */
function bigTarGz(fillerMembers: number): Buffer {
  const entries = [{ name: `${FIRST}.nc`, body: "<SUBMISSION>first</SUBMISSION>" }];
  for (let i = 0; i < fillerMembers; i++) {
    entries.push({
      name: `0009999999-21-${String(i).padStart(6, "0")}.nc`,
      // Varied text so gzip cannot collapse the archive to a couple of chunks.
      body: `<SUBMISSION>filler ${i} ${Math.sin(i).toFixed(12)} ${"x".repeat(200)}</SUBMISSION>`,
    });
  }
  return makeTarGz(entries);
}

function eventStream(events: readonly StreamEvent[]): ReadableStream<StreamEvent> {
  return new ReadableStream<StreamEvent>({
    start(controller) {
      for (const e of events) controller.enqueue(e);
      controller.close();
    },
  });
}

function ctxWithBody(events: ReadableStream<StreamEvent>): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: () => {},
    inputStreams: new Map([["body", events]]),
  } as unknown as IExecuteContext;
}

async function drain(
  task: FeedTarballExtractTask,
  input: Record<string, unknown>,
  context: IExecuteContext
): Promise<{ filingsMatched: number; docsWritten: number } | undefined> {
  let finish: { filingsMatched: number; docsWritten: number } | undefined;
  for await (const event of task.executeStream(input as never, context)) {
    if (event.type === "finish") finish = event.data as never;
  }
  return finish;
}

// --- A canned producer standing in for SecFetchTask { response_type: "stream" }

class CannedBytesTask extends Task<TaskPorts<{ url?: string }>, TaskPorts<{ body?: unknown }>> {
  static readonly type = "CannedBytesTask";
  static readonly category = "SEC";
  static readonly title = "Canned bytes";
  static readonly cacheable = false;

  public bytes: Buffer = Buffer.alloc(0);
  public chunkSize = 4096;
  /** Awaited after every chunk but the last, so a test can observe interleaving. */
  public beforeLastChunk: () => Promise<void> = async () => {};

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { url: { type: "string", title: "URL" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { body: { title: "Body", "x-stream": "binary", format: "blob" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(): AsyncIterable<StreamEvent<{ body?: unknown }>> {
    const total = Math.ceil(this.bytes.length / this.chunkSize);
    for (let i = 0; i < total; i++) {
      if (i === total - 1) await this.beforeLastChunk();
      const at = i * this.chunkSize;
      yield {
        type: "binary-delta",
        port: "body",
        binaryDelta: new Uint8Array(this.bytes.subarray(at, at + this.chunkSize)),
      };
    }
    yield { type: "finish", data: {} };
  }

  async execute(): Promise<{ body?: unknown }> {
    throw new Error("CannedBytesTask only streams");
  }
}

describe("FeedTarballExtractTask", () => {
  it("walks the archive off the live stream and summarizes what it wrote", async () => {
    const gz = makeTarGz([{ name: `${FIRST}.nc`, body: "<SUBMISSION>ok</SUBMISSION>" }]);
    const seen: string[] = [];
    const task = new FeedTarballExtractTask();
    task.writeFiling = (f, text) => {
      seen.push(text);
      expect(f.accession_number).toBe(FIRST);
      return 2;
    };

    const out = await drain(
      task,
      { byAccession: new Map([[FIRST, [filing(FIRST)]]]) },
      ctxWithBody(
        eventStream([
          { type: "binary-delta", port: "body", binaryDelta: new Uint8Array(gz) },
          { type: "finish", data: {} },
        ] as StreamEvent[])
      )
    );

    expect(seen).toEqual(["<SUBMISSION>ok</SUBMISSION>"]);
    expect(out).toEqual({ filingsMatched: 1, docsWritten: 2 });
  });

  it("fails when the stream errors mid-archive rather than reporting a clean day", async () => {
    // Half a tarball followed by an error event. Translated as a clean close,
    // gunzip would see a truncated archive, readExact would return null, the
    // walk loop would break and return NORMALLY — and the caller would mark
    // the day done holding half its documents, with no error anywhere.
    const gz = bigTarGz(200);
    const task = new FeedTarballExtractTask();
    task.writeFiling = () => 1;

    await expect(
      drain(
        task,
        { byAccession: new Map([[FIRST, [filing(FIRST)]]]) },
        ctxWithBody(
          eventStream([
            {
              type: "binary-delta",
              port: "body",
              binaryDelta: new Uint8Array(gz.subarray(0, Math.floor(gz.length / 2))),
            },
            { type: "error", error: new Error("peer reset") },
          ] as unknown as StreamEvent[])
        )
      )
    ).rejects.toThrow("peer reset");
  });

  it("refuses to run without a live body stream rather than taking a materialized value", async () => {
    const task = new FeedTarballExtractTask();
    await expect(
      drain(task, { byAccession: new Map() }, {
        signal: new AbortController().signal,
        updateProgress: () => {},
      } as unknown as IExecuteContext)
    ).rejects.toThrow(/live body stream/);
  });

  it("consumes the producer's bytes as they arrive rather than after it finishes", async () => {
    // The property the whole two-node shape exists for. Under the accumulation
    // path the edge is drained to a value BEFORE the sink starts — a ~1.5 GB
    // day in memory — and nothing would be written until the producer had
    // emitted its last chunk. Here the producer parks before its final chunk
    // and the sink has already written the first member.
    const gz = bigTarGz(400);
    let releaseLastChunk: () => void = () => {};
    const lastChunkReached = new Promise<void>((resolve) => {
      releaseLastChunk = resolve;
    });
    const written: string[] = [];
    let writtenBeforeLastChunk = -1;

    const producer = new CannedBytesTask({ title: "producer" });
    producer.bytes = gz;
    producer.chunkSize = 1024;
    producer.beforeLastChunk = async () => {
      // Give the sink a few turns to consume what it already has, then record
      // how far it got while the producer is still mid-body.
      for (let i = 0; i < 50 && written.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      writtenBeforeLastChunk = written.length;
      releaseLastChunk();
    };

    const sink = new FeedTarballExtractTask({
      defaults: { byAccession: new Map([[FIRST, [filing(FIRST)]]]) },
      title: "sink",
    });
    sink.writeFiling = (_f, text) => {
      written.push(text);
      return 1;
    };

    const graph = new TaskGraph();
    graph.addTask(producer as never);
    graph.addTask(sink as never);
    graph.addDataflow(new Dataflow(producer.config.id, "body", sink.config.id, "body"));

    await graph.run({}, { noAccumulation: true, accumulateLeafOutputs: false });
    await lastChunkReached;

    expect(writtenBeforeLastChunk).toBeGreaterThan(0);
    expect(written).toEqual(["<SUBMISSION>first</SUBMISSION>"]);
    expect(sink.runOutputData).toMatchObject({ filingsMatched: 1, docsWritten: 1 });
  });
});
