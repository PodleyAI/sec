/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IExecuteContext, StreamEvent } from "workglow";
import { ArchiveToFileTask } from "./ArchiveToFileTask";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sec-archive-sink-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function eventStream(events: readonly StreamEvent[]): ReadableStream<StreamEvent> {
  return new ReadableStream<StreamEvent>({
    start(controller) {
      for (const e of events) controller.enqueue(e);
      controller.close();
    },
  });
}

function ctx(events?: ReadableStream<StreamEvent>): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: () => {},
    inputStreams: events ? new Map([["body", events]]) : undefined,
  } as unknown as IExecuteContext;
}

async function drain(
  task: ArchiveToFileTask,
  input: Record<string, unknown>,
  context: IExecuteContext
): Promise<{ bytes: number; wrote: boolean } | undefined> {
  let finish: { bytes: number; wrote: boolean } | undefined;
  for await (const event of task.executeStream(input as never, context)) {
    if (event.type === "finish") finish = event.data as never;
  }
  return finish;
}

describe("ArchiveToFileTask", () => {
  it("writes streamed bytes to destPath and reports progress", async () => {
    const dest = path.join(dir, "submissions.zip");
    const progress: number[] = [];
    const task = new ArchiveToFileTask();
    task.onProgress = (n) => progress.push(n);

    const out = await drain(
      task,
      { destPath: dest },
      ctx(
        eventStream([
          { type: "binary-delta", port: "body", binaryDelta: new Uint8Array([1, 2]) },
          { type: "binary-delta", port: "body", binaryDelta: new Uint8Array([3]) },
          { type: "finish", data: {} },
        ] as StreamEvent[])
      )
    );

    expect(out).toEqual({ bytes: 3, wrote: true });
    expect(progress).toEqual([2, 3]);
    expect(new Uint8Array(readFileSync(dest))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("writes nothing and leaves the existing file alone when no byte arrives", async () => {
    // What a 304 looks like from here: the producer emits no binary-delta, so
    // no stream is created at all. Opening the file up front would truncate
    // the very copy the conditional request certified as still current.
    const dest = path.join(dir, "unchanged.zip");
    writeFileSync(dest, "original");

    const out = await drain(new ArchiveToFileTask(), { destPath: dest }, ctx(undefined));

    expect(out).toEqual({ bytes: 0, wrote: false });
    expect(readFileSync(dest, "utf-8")).toBe("original");
    expect(readdirSync(dir).filter((f) => f.includes(".tmp."))).toEqual([]);
  });

  it("refuses a materialized body rather than quietly writing the buffer it was handed", async () => {
    // The other reason the port can carry no live stream, and the opposite
    // verdict: a value on `body` means the multi-GB edge was drained into
    // memory, which is the cost this sink exists to avoid.
    const dest = path.join(dir, "materialized.zip");
    await expect(
      drain(new ArchiveToFileTask(), { destPath: dest, body: new Blob(["bytes"]) }, ctx(undefined))
    ).rejects.toThrow(/materialized body/);
    expect(existsSync(dest)).toBe(false);
  });

  it("leaves no partial file and no tmp sibling when the stream errors", async () => {
    // A renamed partial is worse than nothing: the next run hands the stump to
    // unzip and reads the failure as a corrupt source rather than a short one.
    const dest = path.join(dir, "partial.zip");
    await expect(
      drain(
        new ArchiveToFileTask(),
        { destPath: dest },
        ctx(
          eventStream([
            { type: "binary-delta", port: "body", binaryDelta: new Uint8Array([1]) },
            { type: "error", error: new Error("peer reset") },
          ] as unknown as StreamEvent[])
        )
      )
    ).rejects.toThrow("peer reset");

    expect(existsSync(dest)).toBe(false);
    expect(readdirSync(dir).filter((f) => f.includes(".tmp."))).toEqual([]);
  });

  it("does not replace an existing archive when the stream errors partway", async () => {
    const dest = path.join(dir, "existing.zip");
    writeFileSync(dest, "previous good archive");
    await expect(
      drain(
        new ArchiveToFileTask(),
        { destPath: dest },
        ctx(
          eventStream([
            { type: "binary-delta", port: "body", binaryDelta: new Uint8Array([9]) },
            { type: "error", error: new Error("peer reset") },
          ] as unknown as StreamEvent[])
        )
      )
    ).rejects.toThrow("peer reset");
    expect(readFileSync(dest, "utf-8")).toBe("previous good archive");
  });

  it("requires a destPath", async () => {
    await expect(drain(new ArchiveToFileTask(), {}, ctx(undefined))).rejects.toThrow(/destPath/);
  });
});
