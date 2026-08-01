/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { BootstrapDownloadTask, streamDownloadToFile } from "./BootstrapDownloadTask";

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "sec-download-test-"));
});

afterEach(() => {
  // Strip any env-derived binding a test set (e.g. SEC_RAW_DATA_FOLDER) so it
  // does not leak into a later test file's container.
  resetDependencyInjectionsForTesting();
});

// TODO: streamDownloadToFile calls Bun.file(...).writer() to sink the response
// body to disk, so every test in this block needs a Bun runtime. Migrate the
// production streamer to node:fs/promises (or fs.createWriteStream) so both
// runtimes can drive it, then drop this skip.
describe.skipIf(typeof Bun === "undefined")("streamDownloadToFile", () => {
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
    (global as any).fetch = vi.fn(async () => {
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
    (global as any).fetch = vi.fn(async () => new Response("nope", { status: 404 }));
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
    (global as any).fetch = vi.fn(async () => {
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
      await expect(streamDownloadToFile("https://example/aborts", dest)).rejects.toThrow(
        /connection reset/
      );
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
    (global as any).fetch = vi.fn(async () => {
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
      await expect(streamDownloadToFile("https://example/short", dest)).rejects.toThrow(
        /size mismatch/
      );
      expect(existsSync(dest)).toBe(false);
    } finally {
      (global as any).fetch = oldFetch;
      rmSync(path.join(tmpRoot, "short.bin"), { force: true });
    }
  });

  it("streamDownloadToFile rejects malformed Content-Length", async () => {
    // Server advertises `123abc`. `parseInt` would have returned 123 and
    // silently downgraded integrity to a wrong-but-passable check; we
    // fail closed instead so the caller sees the protocol violation.
    const body = new TextEncoder().encode("0123456789");
    const oldFetch = global.fetch;
    (global as any).fetch = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-length": "123abc" },
      });
    });
    try {
      const dest = path.join(tmpRoot, "bad-len.bin");
      await expect(streamDownloadToFile("https://example/bad-len", dest)).rejects.toThrow(
        /Invalid Content-Length/
      );
    } finally {
      (global as any).fetch = oldFetch;
      rmSync(path.join(tmpRoot, "bad-len.bin"), { force: true });
    }
  });

  it("streamDownloadToFile accepts whitespace-padded Content-Length", async () => {
    // Surrounding whitespace is harmless and must not trip the strict
    // parser — many proxies normalise headers with stray spaces.
    const body = new TextEncoder().encode("0123456789");
    const oldFetch = global.fetch;
    (global as any).fetch = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-length": "  10  " },
      });
    });
    try {
      const dest = path.join(tmpRoot, "padded-len.bin");
      const result = await streamDownloadToFile("https://example/padded-len", dest);
      expect(result.bytes).toBe(10);
      expect(result.totalBytes).toBe(10);
      expect(readFileSync(dest, "utf-8")).toBe("0123456789");
    } finally {
      (global as any).fetch = oldFetch;
      rmSync(path.join(tmpRoot, "padded-len.bin"), { force: true });
    }
  });

  it("streamDownloadToFile rejects negative Content-Length", async () => {
    // A negative value is malformed under RFC 9110; we fail closed rather
    // than silently downgrade to no-integrity-check.
    const body = new TextEncoder().encode("hello");
    const oldFetch = global.fetch;
    (global as any).fetch = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-length": "-5" },
      });
    });
    try {
      const dest = path.join(tmpRoot, "neg-len.bin");
      await expect(streamDownloadToFile("https://example/neg-len", dest)).rejects.toThrow(
        /Invalid Content-Length/
      );
    } finally {
      (global as any).fetch = oldFetch;
      rmSync(path.join(tmpRoot, "neg-len.bin"), { force: true });
    }
  });

  it("accepts RFC 9112 duplicate-equal Content-Length values", async () => {
    // CloudFront / Akamai / ELB sometimes emit two `Content-Length: N`
    // header lines. Headers.append combines them into a single
    // comma-joined string "N, N". RFC 9112 §6.3 explicitly allows the
    // recipient to combine duplicate equal values. The strict regex
    // introduced in PR #125 rejected this real-world value; we now
    // accept it while still rejecting genuinely conflicting values.
    const body = new TextEncoder().encode("0123456789");
    const oldFetch = global.fetch;
    (global as any).fetch = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      });
      // Build the header via append so we get the RFC 9112 combined form.
      const h = new Headers();
      h.append("content-length", "10");
      h.append("content-length", "10");
      return new Response(stream, { status: 200, headers: h });
    });
    try {
      const dest = path.join(tmpRoot, "dup-equal-len.bin");
      const result = await streamDownloadToFile("https://example/dup-equal", dest);
      expect(result.bytes).toBe(10);
      expect(result.totalBytes).toBe(10);
      expect(readFileSync(dest, "utf-8")).toBe("0123456789");
    } finally {
      (global as any).fetch = oldFetch;
      rmSync(path.join(tmpRoot, "dup-equal-len.bin"), { force: true });
    }
  });

  it("rejects mismatched duplicate Content-Length values", async () => {
    // Two Content-Length lines with different values are a genuine
    // protocol error. RFC 9112 §6.3 requires equal duplicates; mismatched
    // duplicates must fail closed.
    const body = new TextEncoder().encode("0123456789");
    const oldFetch = global.fetch;
    (global as any).fetch = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      });
      const h = new Headers();
      h.append("content-length", "10");
      h.append("content-length", "20");
      return new Response(stream, { status: 200, headers: h });
    });
    try {
      const dest = path.join(tmpRoot, "dup-mismatched-len.bin");
      await expect(streamDownloadToFile("https://example/dup-mismatched", dest)).rejects.toThrow(
        /Conflicting Content-Length/
      );
    } finally {
      (global as any).fetch = oldFetch;
      rmSync(path.join(tmpRoot, "dup-mismatched-len.bin"), { force: true });
    }
  });

  it("handles responses with no content-length header", async () => {
    const oldFetch = global.fetch;
    (global as any).fetch = vi.fn(async () => {
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

// TODO: BootstrapDownloadTask.execute drives unzip via Bun.spawn / Bun.which
// and the tests here stub those globals directly. Migrate the production task
// to node:child_process for a portable spawn, then drop this skip.
describe.skipIf(typeof Bun === "undefined")("BootstrapDownloadTask.execute zip cleanup", () => {
  // The zip is downloaded into SEC_RAW_DATA_FOLDER and then handed to
  // `unzip`. On any extraction failure the multi-GB staged archive must
  // not leak — the success path also removes it. These tests stub
  // fetch/Bun.spawn/Bun.which so the body never makes a real network
  // call or runs a real subprocess.

  function setupRawDataFolder(): {
    folder: string;
    targetFolder: string;
    zipPath: string;
  } {
    const folder = mkdtempSync(path.join(tmpdir(), "sec-bootstrap-test-"));
    const targetFolder = "extract-target";
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, folder);
    return {
      folder,
      targetFolder,
      zipPath: path.join(folder, `${targetFolder}.zip`),
    };
  }

  function stubFetchToWriteZip(): () => void {
    const oldFetch = global.fetch;
    (global as any).fetch = vi.fn(async () => {
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
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((cmd: readonly string[]) =>
      opts.spawn(cmd)) as typeof Bun.spawn;
    (Bun as unknown as { which: typeof Bun.which }).which = ((_name: string) =>
      "/usr/bin/unzip") as typeof Bun.which;
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
    const { folder, targetFolder, zipPath } = setupRawDataFolder();
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
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("removes the staged zip when unzip exits non-zero", async () => {
    const { folder, targetFolder, zipPath } = setupRawDataFolder();
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
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("removes the staged zip on the success path too", async () => {
    const { folder, targetFolder, zipPath } = setupRawDataFolder();
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
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe.skipIf(typeof Bun === "undefined")("BootstrapDownloadTask conditional download", () => {
  // The bulk archives are ~1.5 GB each and EDGAR serves ETag/Last-Modified on
  // both, so a re-run should ask "changed?" rather than re-pulling. These tests
  // pin the marker round-trip, the 304 skip, and the -uo/-o flag choice.

  const URL = "https://example/file.zip";

  function setup(): { folder: string; targetFolder: string; targetDir: string; zipPath: string } {
    const folder = mkdtempSync(path.join(tmpdir(), "sec-conditional-test-"));
    const targetFolder = "extract-target";
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, folder);
    return {
      folder,
      targetFolder,
      targetDir: path.join(folder, targetFolder),
      zipPath: path.join(folder, `${targetFolder}.zip`),
    };
  }

  /** Records the headers each request carried, and replies with `status`. */
  function stubFetch(opts: {
    status?: number;
    etag?: string;
    lastModified?: string;
  }): { seen: Record<string, string>[]; restore: () => void } {
    const seen: Record<string, string>[] = [];
    const oldFetch = global.fetch;
    (global as any).fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push({ ...((init?.headers as Record<string, string>) ?? {}) });
      const headers: Record<string, string> = {};
      if (opts.etag !== undefined) headers.etag = opts.etag;
      if (opts.lastModified !== undefined) headers["last-modified"] = opts.lastModified;
      if (opts.status === 304) {
        return new Response(null, { status: 304, headers });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { ...headers, "content-length": "4" },
      });
    });
    return { seen, restore: () => ((global as any).fetch = oldFetch) };
  }

  function stubBun(): { cmds: readonly string[][]; restore: () => void } {
    const cmds: string[][] = [];
    const realSpawn = Bun.spawn;
    const realWhich = Bun.which;
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((cmd: readonly string[]) => {
      cmds.push([...cmd]);
      return { exited: Promise.resolve(0) };
    }) as unknown as typeof Bun.spawn;
    (Bun as unknown as { which: typeof Bun.which }).which = ((_n: string) =>
      "/usr/bin/unzip") as typeof Bun.which;
    return {
      cmds,
      restore: () => {
        (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = realSpawn;
        (Bun as unknown as { which: typeof Bun.which }).which = realWhich;
      },
    };
  }

  const ctx = {
    signal: new AbortController().signal,
    updateProgress: async () => {},
  } as unknown as Parameters<BootstrapDownloadTask["execute"]>[1];

  it("sends no conditional header on a first run and records a marker", async () => {
    const { folder, targetFolder } = setup();
    const fetchStub = stubFetch({ etag: '"abc"', lastModified: "Fri, 31 Jul 2026 04:40:43 GMT" });
    const bun = stubBun();
    try {
      const input = { url: URL, targetFolder };
      await new BootstrapDownloadTask({ defaults: input }).execute(input, ctx);

      expect(fetchStub.seen[0]["If-None-Match"]).toBeUndefined();
      const marker = JSON.parse(
        readFileSync(path.join(folder, ".bulk-done", `${targetFolder}.json`), "utf8")
      );
      expect(marker.etag).toBe('"abc"');
      expect(marker.contentLength).toBe(4);
      expect(marker.url).toBe(URL);
    } finally {
      bun.restore();
      fetchStub.restore();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("sends BOTH validators and skips extraction entirely on 304", async () => {
    // www.sec.gov ignores If-None-Match but honours If-Modified-Since, so
    // sending only the ETag would never produce a 304 against the real origin.
    const { folder, targetFolder, targetDir } = setup();
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, "already-here.json"), "{}");
    mkdirSync(path.join(folder, ".bulk-done"), { recursive: true });
    writeFileSync(
      path.join(folder, ".bulk-done", `${targetFolder}.json`),
      JSON.stringify({
        url: URL,
        etag: '"abc"',
        lastModified: "Fri, 31 Jul 2026 04:40:43 GMT",
        contentLength: 4,
        extractedAt: "2026-07-31",
      })
    );
    const fetchStub = stubFetch({ status: 304, etag: '"abc"' });
    const bun = stubBun();
    try {
      const input = { url: URL, targetFolder };
      const result = await new BootstrapDownloadTask({ defaults: input }).execute(input, ctx);

      expect(result.success).toBe(true);
      expect(fetchStub.seen[0]["If-None-Match"]).toBe('"abc"');
      expect(fetchStub.seen[0]["If-Modified-Since"]).toBe("Fri, 31 Jul 2026 04:40:43 GMT");
      expect(bun.cmds).toHaveLength(0); // never unzipped
    } finally {
      bun.restore();
      fetchStub.restore();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("ignores a marker whose extracted tree is gone", async () => {
    const { folder, targetFolder } = setup();
    mkdirSync(path.join(folder, ".bulk-done"), { recursive: true });
    writeFileSync(
      path.join(folder, ".bulk-done", `${targetFolder}.json`),
      JSON.stringify({ url: URL, etag: '"abc"', contentLength: 4, extractedAt: "2026-07-31" })
    );
    const fetchStub = stubFetch({ etag: '"def"' });
    const bun = stubBun();
    try {
      const input = { url: URL, targetFolder };
      await new BootstrapDownloadTask({ defaults: input }).execute(input, ctx);

      // No target dir contents => marker untrusted => unconditional download.
      expect(fetchStub.seen[0]["If-None-Match"]).toBeUndefined();
      expect(bun.cmds).toHaveLength(1);
    } finally {
      bun.restore();
      fetchStub.restore();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("extracts with -uo normally and -o under force, and force skips the marker", async () => {
    const { folder, targetFolder, targetDir } = setup();
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, "already-here.json"), "{}");
    mkdirSync(path.join(folder, ".bulk-done"), { recursive: true });
    writeFileSync(
      path.join(folder, ".bulk-done", `${targetFolder}.json`),
      JSON.stringify({ url: URL, etag: '"abc"', contentLength: 4, extractedAt: "2026-07-31" })
    );
    const fetchStub = stubFetch({ etag: '"changed"' });
    const bun = stubBun();
    try {
      const plain = { url: URL, targetFolder };
      await new BootstrapDownloadTask({ defaults: plain }).execute(plain, ctx);
      expect(bun.cmds[0]).toContain("-uo");
      expect(fetchStub.seen[0]["If-None-Match"]).toBe('"abc"');

      const forced = { url: URL, targetFolder, force: true };
      await new BootstrapDownloadTask({ defaults: forced }).execute(forced, ctx);
      expect(bun.cmds[1]).toContain("-o");
      expect(bun.cmds[1]).not.toContain("-uo");
      expect(fetchStub.seen[1]["If-None-Match"]).toBeUndefined();
    } finally {
      bun.restore();
      fetchStub.restore();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("skips extraction when a 200 comes back with the same ETag and length", async () => {
    const { folder, targetFolder, targetDir, zipPath } = setup();
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, "already-here.json"), "{}");
    mkdirSync(path.join(folder, ".bulk-done"), { recursive: true });
    writeFileSync(
      path.join(folder, ".bulk-done", `${targetFolder}.json`),
      JSON.stringify({ url: URL, etag: '"abc"', contentLength: 4, extractedAt: "2026-07-31" })
    );
    // Origin ignores the conditional header and replies 200 with identical bytes.
    const fetchStub = stubFetch({ etag: '"abc"' });
    const bun = stubBun();
    try {
      const input = { url: URL, targetFolder };
      const result = await new BootstrapDownloadTask({ defaults: input }).execute(input, ctx);

      expect(result.success).toBe(true);
      expect(bun.cmds).toHaveLength(0);
      expect(existsSync(zipPath)).toBe(false); // staged zip binned
    } finally {
      bun.restore();
      fetchStub.restore();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
