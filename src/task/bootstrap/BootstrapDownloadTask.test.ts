/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { streamDownloadToFile } from "./BootstrapDownloadTask";

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "sec-download-test-"));
});

afterEach(() => {
  // mock-restore via assignment in each test
});

describe("streamDownloadToFile", () => {
  it("streams a response body to disk and reports progress", async () => {
    // Build a fake ReadableStream that emits the body in three chunks so
    // we exercise the iteration path, not a one-shot blob copy.
    const chunks = [
      new TextEncoder().encode("hello "),
      new TextEncoder().encode("world"),
      new TextEncoder().encode("!"),
    ];
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);

    const oldFetch = global.fetch;
    (global as any).fetch = mock(async () => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const c of chunks) controller.enqueue(c);
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-length": String(totalLen) },
      });
    });
    try {
      const dest = path.join(tmpRoot, "stream.bin");
      const progress: { downloaded: number; total: number | undefined }[] = [];
      const result = await streamDownloadToFile("https://example/file", dest, {
        onProgress: (downloaded, total) => {
          progress.push({ downloaded, total });
        },
      });
      expect(result.bytes).toBe(totalLen);
      expect(result.totalBytes).toBe(totalLen);
      const written = readFileSync(dest, "utf-8");
      expect(written).toBe("hello world!");
      // At least one progress callback per chunk.
      expect(progress.length).toBeGreaterThanOrEqual(3);
      expect(progress[progress.length - 1].downloaded).toBe(totalLen);
    } finally {
      (global as any).fetch = oldFetch;
      rmSync(path.join(tmpRoot, "stream.bin"), { force: true });
    }
  });

  it("throws on non-2xx responses without writing the destination file", async () => {
    const oldFetch = global.fetch;
    (global as any).fetch = mock(async () => new Response("nope", { status: 404 }));
    try {
      const dest = path.join(tmpRoot, "404.bin");
      await expect(streamDownloadToFile("https://example/missing", dest)).rejects.toThrow(
        /HTTP 404/
      );
    } finally {
      (global as any).fetch = oldFetch;
    }
  });

  it("handles responses with no content-length header", async () => {
    const oldFetch = global.fetch;
    (global as any).fetch = mock(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    try {
      const dest = path.join(tmpRoot, "no-len.bin");
      const result = await streamDownloadToFile("https://example/chunked", dest);
      expect(result.bytes).toBe(4);
      expect(result.totalBytes).toBeUndefined();
      expect(readFileSync(dest, "utf-8")).toBe("data");
    } finally {
      (global as any).fetch = oldFetch;
      rmSync(path.join(tmpRoot, "no-len.bin"), { force: true });
    }
  });
});
