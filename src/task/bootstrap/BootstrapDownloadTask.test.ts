/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { globalServiceRegistry } from "workglow";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { BootstrapDownloadTask, streamDownloadToFile } from "./BootstrapDownloadTask";

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

  it("removes the destination file when the stream aborts mid-download", async () => {
    // Simulates the multi-GB EDGAR-bulk download case where the connection
    // drops after partial bytes. The old implementation left a half-written
    // archive on disk that the next bootstrap run would silently feed to
    // unzip. The wrapper must catch the stream error, remove the partial
    // file, and rethrow so the caller surfaces the failure.
    const oldFetch = global.fetch;
    (global as any).fetch = mock(async () => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("first-half"));
          // Defer the abort to the next microtask so the first chunk has
          // already been written to disk before we tear the stream down.
          await Promise.resolve();
          controller.error(new Error("connection reset"));
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-length": "100" },
      });
    });
    try {
      const dest = path.join(tmpRoot, "aborted.bin");
      await expect(
        streamDownloadToFile("https://example/aborts", dest)
      ).rejects.toThrow(/connection reset/);
      // The partial file must not be left behind for the next bootstrap
      // run to mistake for a complete archive.
      expect(existsSync(dest)).toBe(false);
    } finally {
      (global as any).fetch = oldFetch;
      rmSync(path.join(tmpRoot, "aborted.bin"), { force: true });
    }
  });

  it("throws and removes the destination when content-length mismatch is detected", async () => {
    // Server advertised 10 bytes but only sent 4. We want a hard failure
    // (with cleanup) rather than silently honouring a truncated archive.
    const oldFetch = global.fetch;
    (global as any).fetch = mock(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("abcd"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-length": "10" },
      });
    });
    try {
      const dest = path.join(tmpRoot, "short.bin");
      await expect(
        streamDownloadToFile("https://example/short", dest)
      ).rejects.toThrow(/size mismatch/);
      expect(existsSync(dest)).toBe(false);
    } finally {
      (global as any).fetch = oldFetch;
      rmSync(path.join(tmpRoot, "short.bin"), { force: true });
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

describe("BootstrapDownloadTask.execute zip cleanup", () => {
  // The zip is downloaded into SEC_RAW_DATA_FOLDER and then handed to
  // `unzip`. On any extraction failure the multi-GB staged archive must
  // not leak — the success path also removes it. These tests stub
  // fetch/Bun.spawn/Bun.which so the body never makes a real network
  // call or runs a real subprocess.

  function setupRawDataFolder(): {
    folder: string;
    targetFolder: string;
    zipPath: string;
    restore: () => void;
  } {
    const folder = mkdtempSync(path.join(tmpdir(), "sec-bootstrap-test-"));
    const targetFolder = "extract-target";
    // Snapshot the previous binding (if any) so we can restore it on
    // teardown. ServiceRegistry has no `unregister` API, so the best we
    // can do is restore-to-previous; this avoids polluting later test
    // files with a stray tmp folder path that no longer exists on disk.
    const hadPrevious = globalServiceRegistry.has(SEC_RAW_DATA_FOLDER);
    const previous = hadPrevious ? globalServiceRegistry.get(SEC_RAW_DATA_FOLDER) : undefined;
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, folder);
    return {
      folder,
      targetFolder,
      zipPath: path.join(folder, `${targetFolder}.zip`),
      restore: () => {
        if (hadPrevious) {
          globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, previous as string);
        }
        // else: no API to unregister; leave the stale binding in place.
        // Subsequent test files that need SEC_RAW_DATA_FOLDER must
        // register their own value, so this is acceptable in practice.
      },
    };
  }

  function stubFetchToWriteZip(): () => void {
    const oldFetch = global.fetch;
    (global as any).fetch = mock(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // Minimal ZIP magic bytes — we never actually unzip in these
          // tests because Bun.spawn is stubbed.
          controller.enqueue(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-length": "4" },
      });
    });
    return () => {
      (global as any).fetch = oldFetch;
    };
  }

  function stubBun(opts: {
    spawn: (cmd: readonly string[]) => { exited: Promise<number> } | never;
  }): () => void {
    const realSpawn = Bun.spawn;
    const realWhich = Bun.which;
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((
      cmd: readonly string[]
    ) => opts.spawn(cmd)) as typeof Bun.spawn;
    (Bun as unknown as { which: typeof Bun.which }).which = ((
      _name: string
    ) => "/usr/bin/unzip") as typeof Bun.which;
    return () => {
      (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = realSpawn;
      (Bun as unknown as { which: typeof Bun.which }).which = realWhich;
    };
  }

  const ctx = {
    signal: new AbortController().signal,
    updateProgress: async () => {},
  } as unknown as Parameters<BootstrapDownloadTask["execute"]>[1];

  it("removes the staged zip when Bun.spawn throws synchronously", async () => {
    const { folder, targetFolder, zipPath, restore } = setupRawDataFolder();
    const restoreFetch = stubFetchToWriteZip();
    const restoreBun = stubBun({
      spawn: () => {
        throw new Error("spawn refused");
      },
    });
    try {
      const input = { url: "https://example/file.zip", targetFolder };
      const task = new BootstrapDownloadTask({ defaults: input });
      await expect(task.execute(input, ctx)).rejects.toThrow(/spawn refused/);
      expect(existsSync(zipPath)).toBe(false);
    } finally {
      restoreBun();
      restoreFetch();
      restore();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("removes the staged zip when unzip exits non-zero", async () => {
    const { folder, targetFolder, zipPath, restore } = setupRawDataFolder();
    const restoreFetch = stubFetchToWriteZip();
    const restoreBun = stubBun({
      spawn: () => ({ exited: Promise.resolve(1) }),
    });
    try {
      const input = { url: "https://example/file.zip", targetFolder };
      const task = new BootstrapDownloadTask({ defaults: input });
      await expect(task.execute(input, ctx)).rejects.toThrow(/unzip exited with code 1/);
      expect(existsSync(zipPath)).toBe(false);
    } finally {
      restoreBun();
      restoreFetch();
      restore();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("removes the staged zip on the success path too", async () => {
    const { folder, targetFolder, zipPath, restore } = setupRawDataFolder();
    const restoreFetch = stubFetchToWriteZip();
    const restoreBun = stubBun({
      spawn: () => ({ exited: Promise.resolve(0) }),
    });
    try {
      // Pre-create a dummy file at zipPath to prove the success-path
      // cleanup actually removes it (the streamed fetch above will also
      // overwrite it; the dummy just makes the assertion meaningful if
      // someone refactors the stream stub).
      writeFileSync(zipPath, "placeholder");
      const input = { url: "https://example/file.zip", targetFolder };
      const task = new BootstrapDownloadTask({ defaults: input });
      const result = await task.execute(input, ctx);
      expect(result.success).toBe(true);
      expect(existsSync(zipPath)).toBe(false);
    } finally {
      restoreBun();
      restoreFetch();
      restore();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
