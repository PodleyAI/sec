/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent } from "workglow";

/**
 * Adapts a task-graph event stream into the raw bytes a Node consumer (gunzip,
 * a file writer) expects, taking the `binary-delta` payloads of one port and
 * dropping every other event.
 *
 * An `error` event MUST become a **throw**, never a clean end. This is the
 * load-bearing half: on a clean end a gzip/tar reader is handed a truncated
 * archive, its read loop finishes normally, and the caller records a partial
 * result as a complete one — the failure disappears with no error anywhere and
 * the day is marked done holding half its documents.
 *
 * An async generator rather than a `ReadableStream`, because this is exactly
 * where the two runtimes diverge: wrapping an errored WHATWG stream through
 * `Readable.fromWeb` does not reliably surface the error as a rejection under
 * Bun, so the truncated-archive case hung instead of failing. A generator that
 * throws is the one shape both `Readable.from` and a plain `for await` treat
 * the same.
 */
export async function* byteIterableFromEvents(
  events: ReadableStream<StreamEvent>,
  port: string
): AsyncGenerator<Uint8Array> {
  const reader = events.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || value === undefined) return;
      if (value.type === "error") {
        throw (value as { error?: unknown }).error ?? new Error("stream failed");
      }
      if (value.type === "finish") return;
      if (value.type === "binary-delta" && value.port === port) {
        yield value.binaryDelta;
      }
    }
  } finally {
    // Releasing the lock (rather than cancelling) leaves the producer's own
    // teardown to the framework: this generator can be abandoned mid-archive
    // by a consumer that stops early, and cancelling would tear down a stream
    // the runner still owns.
    reader.releaseLock();
  }
}
