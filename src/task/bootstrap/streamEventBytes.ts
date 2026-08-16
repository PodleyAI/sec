/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent } from "workglow";

/**
 * Adapts a task-graph event stream into the raw byte stream a Node consumer
 * (gunzip, a file writer) expects, taking the `binary-delta` payloads of one
 * port and dropping every other event.
 *
 * An `error` event MUST become a stream **error**, never a clean close. This is
 * the load-bearing half: on a clean close a gzip/tar reader is handed a
 * truncated archive, its read loop ends normally, and the caller records a
 * partial result as a complete one — the failure disappears with no error
 * anywhere and the day is marked done holding half its documents.
 */
export function byteStreamFromEvents(
  events: ReadableStream<StreamEvent>,
  port: string
): ReadableStream<Uint8Array> {
  const reader = events.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Loops rather than returning on every event: control events carry no
      // bytes, and returning on one would end this pull having enqueued
      // nothing, which a byte reader sees as end-of-stream.
      while (true) {
        const { done, value } = await reader.read();
        if (done || value === undefined) {
          controller.close();
          return;
        }
        if (value.type === "error") {
          controller.error((value as { error?: unknown }).error ?? new Error("stream failed"));
          return;
        }
        if (value.type === "finish") {
          controller.close();
          return;
        }
        if (value.type === "binary-delta" && value.port === port) {
          controller.enqueue(value.binaryDelta);
          return;
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
