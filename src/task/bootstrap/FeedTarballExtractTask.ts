/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from "node:stream";
import type { DataPortSchema, IExecuteContext, StreamEvent } from "workglow";
import { Task } from "workglow";
import type { TaskPorts } from "../taskPorts";
import type { FeedFiling } from "./feedFilings";
import { streamFeedTarball } from "./feedTarball";
import { byteIterableFromEvents } from "./streamEventBytes";

export interface FeedTarballExtractTaskInput {
  /** Streaming port: the gzipped daily Feed tarball, as it arrives. */
  readonly body?: unknown;
  /** Filings to keep, grouped by accession — one accession can have co-filers. */
  readonly byAccession?: ReadonlyMap<string, readonly FeedFiling[]>;
}

export interface FeedTarballExtractTaskOutput {
  readonly filingsMatched: number;
  readonly docsWritten: number;
}

const inputSchema = {
  type: "object",
  properties: {
    body: {
      title: "Body",
      description: "Gzipped daily feed tarball",
      "x-stream": "binary",
    },
    byAccession: { title: "Filings by accession" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    filingsMatched: { type: "number", title: "Filings matched" },
    docsWritten: { type: "number", title: "Documents written" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Consumes a Feed tarball's bytes as they arrive and hands each wanted
 * submission to {@link writeFiling}.
 *
 * A pure sink: it produces a small summary and never a stream, so the framework
 * recognizes it through the stream-CONSUMER predicate rather than the producer
 * one. Peak memory is one buffered submission plus the gunzip window — never
 * the multi-GB day — which is the only reason a Feed download can run inside
 * the task graph at all.
 */
export class FeedTarballExtractTask extends Task<
  TaskPorts<FeedTarballExtractTaskInput>,
  TaskPorts<FeedTarballExtractTaskOutput>
> {
  static readonly type = "FeedTarballExtractTask";
  static readonly category = "SEC";
  static readonly title = "Extract feed tarball";
  static readonly cacheable = false;

  public static inputSchema(): DataPortSchema {
    return inputSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema;
  }

  /**
   * Writes one submission's cache files and returns how many it wrote. Supplied
   * by the caller, which owns the cache layout and the resume bookkeeping; this
   * task owns only the walk.
   *
   * The default THROWS rather than returning 0: an unwired writer would walk
   * the whole day, report `docsWritten: 0`, and let the caller mark the day
   * `.feed-done` — silently skipping it on every later run.
   */
  public writeFiling: (filing: FeedFiling, submissionText: string) => number = () => {
    throw new Error("FeedTarballExtractTask.writeFiling was never wired by the caller");
  };

  async *executeStream(
    input: FeedTarballExtractTaskInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<FeedTarballExtractTaskOutput>> {
    const events = context.inputStreams?.get("body");
    if (!events) {
      // Not a recoverable state: with no live stream the alternative is a
      // materialized 1.5 GB value on the edge, which is the cost this whole
      // path exists to avoid. Fail rather than silently take it.
      throw new Error("FeedTarballExtractTask requires a live body stream on its 'body' port");
    }
    const byAccession = input.byAccession ?? new Map<string, readonly FeedFiling[]>();

    let filingsMatched = 0;
    let docsWritten = 0;

    await streamFeedTarball(
      Readable.from(byteIterableFromEvents(events, "body")),
      (accession) => byAccession.has(accession),
      (entry) => {
        const rows = byAccession.get(entry.accession);
        if (!rows) return;
        for (const filing of rows) {
          filingsMatched++;
          docsWritten += this.writeFiling(filing, entry.text);
        }
      },
      context.signal
    );

    yield { type: "finish", data: { filingsMatched, docsWritten } };
  }

  async execute(): Promise<FeedTarballExtractTaskOutput> {
    throw new Error("FeedTarballExtractTask only runs as a stream consumer");
  }
}
