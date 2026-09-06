/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  globalServiceRegistry,
  Task,
  type DataPortSchema,
  type ITask,
  type StreamEvent,
} from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import type { TaskPorts } from "../taskPorts";
import {
  BootstrapDownloadTask,
  readBulkArchiveMarker,
  writeBulkArchiveMarker,
} from "./BootstrapDownloadTask";

/**
 * Stands in for `SecFetchTask` with `response_type: "stream"`: same `body`
 * port, same binary deltas, same `metadata` on finish. Everything downstream —
 * the graph edge, the passthrough, ArchiveToFileTask, the tmp+rename — is
 * production code.
 */
class CannedArchiveFetchTask extends Task<
  TaskPorts<{ url?: string }>,
  TaskPorts<{ body?: unknown; metadata?: Record<string, unknown> }>
> {
  static readonly type = "CannedArchiveFetchTask";
  static readonly category = "SEC";
  static readonly title = "Canned archive download";
  static readonly cacheable = false;

  public bodyBytes: Uint8Array | undefined = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  /**
   * NOT named `status`: `Task` owns a `status` field of its own (the runner
   * sets it to "STREAMING"), and shadowing it made every canned 304 read back
   * as a 200 with a body.
   */
  public responseStatus = 200;
  public etag: string | undefined;
  public lastModified: string | undefined;

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
      properties: {
        body: { title: "Body", "x-stream": "binary", format: "blob" },
        metadata: { type: "object", title: "Metadata", additionalProperties: true },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(): AsyncIterable<
    StreamEvent<{ body?: unknown; metadata?: Record<string, unknown> }>
  > {
    const headers: Record<string, string> = {};
    if (this.etag !== undefined) headers.etag = this.etag;
    if (this.lastModified !== undefined) headers["last-modified"] = this.lastModified;
    // A 304 carries no body at all — no binary-delta, so the sink never opens
    // its tmp file and the archive already on disk is left untouched.
    if (this.responseStatus !== 304 && this.bodyBytes !== undefined) {
      yield { type: "binary-delta", port: "body", binaryDelta: this.bodyBytes };
    }
    yield {
      type: "finish",
      data: {
        metadata: {
          status: this.responseStatus,
          notModified: this.responseStatus === 304,
          headers,
        },
      },
    };
  }

  async execute(): Promise<{ body?: unknown }> {
    throw new Error("CannedArchiveFetchTask only streams");
  }
}

/** Records the headers each archive request carried, and replies from a canned response. */
class TestBootstrapDownloadTask extends BootstrapDownloadTask {
  public readonly seenHeaders: Record<string, string>[] = [];
  public response: {
    status?: number;
    etag?: string;
    lastModified?: string;
    /** A 200 that carries no body at all — the sink writes nothing. */
    emptyBody?: boolean;
  } = {};

  protected override createArchiveFetchTask(_url: string, headers: Record<string, string>): ITask {
    this.seenHeaders.push({ ...headers });
    const task = new CannedArchiveFetchTask({ title: "Download archive" });
    if (this.response.emptyBody === true) task.bodyBytes = undefined;
    task.responseStatus = this.response.status ?? 200;
    task.etag = this.response.etag;
    task.lastModified = this.response.lastModified;
    return task as unknown as ITask;
  }
}

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "sec-download-test-"));
});

afterEach(() => {
  // Strip any env-derived binding a test set (e.g. SEC_RAW_DATA_FOLDER) so it
  // does not leak into a later test file's container.
  resetDependencyInjectionsForTesting();
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

  function stubBun(opts: {
    spawn: (cmd: readonly string[]) => { exited: Promise<number> } | never;
  }): () => void {
    const realSpawn = Bun.spawn;
    const realWhich = Bun.which;
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((cmd: readonly string[]) =>
      opts.spawn(cmd)) as unknown as typeof Bun.spawn;
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
    own: <T>(value: T) => value,
    disown: () => {},
  } as unknown as Parameters<BootstrapDownloadTask["execute"]>[1];

  it("removes the staged zip when Bun.spawn throws synchronously", async () => {
    const { folder, targetFolder, zipPath } = setupRawDataFolder();
    const restoreBun = stubBun({
      spawn: () => {
        throw new Error("spawn refused");
      },
    });
    try {
      const input = { url: "https://example/file.zip", targetFolder };
      const task = new TestBootstrapDownloadTask({ defaults: input });
      await expect(task.execute(input, ctx)).rejects.toThrow(/spawn refused/);
      expect(existsSync(zipPath)).toBe(false);
    } finally {
      restoreBun();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("removes the staged zip when unzip exits non-zero", async () => {
    const { folder, targetFolder, zipPath } = setupRawDataFolder();
    const restoreBun = stubBun({
      spawn: () => ({ exited: Promise.resolve(1) }),
    });
    try {
      const input = { url: "https://example/file.zip", targetFolder };
      const task = new TestBootstrapDownloadTask({ defaults: input });
      await expect(task.execute(input, ctx)).rejects.toThrow(/unzip exited with code 1/);
      expect(existsSync(zipPath)).toBe(false);
    } finally {
      restoreBun();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("removes the staged zip on the success path too", async () => {
    const { folder, targetFolder, zipPath } = setupRawDataFolder();
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
      const task = new TestBootstrapDownloadTask({ defaults: input });
      const result = await task.execute(input, ctx);
      expect(result.success).toBe(true);
      expect(existsSync(zipPath)).toBe(false);
    } finally {
      restoreBun();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

/** True for the tests below that drive `unzip` through `Bun.spawn`. */
const NEEDS_BUN = typeof Bun === "undefined";

describe("BootstrapDownloadTask conditional download", () => {
  // The bulk archives are ~1.5 GB each and EDGAR serves ETag/Last-Modified on
  // both, so a re-run should ask "changed?" rather than re-pulling. These tests
  // pin the marker round-trip, the 304 skip, and the -uo/-o flag choice.
  //
  // The describe is NOT Bun-gated as a whole: the repo's `test` script is
  // `vitest run`, so gating it hid the 304 and matching-ETag paths — the ones
  // this file exists for — from the only command CI runs. Only the tests that
  // actually reach `Bun.which`/`Bun.spawn` (i.e. those that extract) are
  // skipped off Bun; the two that short-circuit before extraction are not.

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

  function stubBun(): { cmds: readonly string[][]; restore: () => void } {
    const cmds: string[][] = [];
    // Off Bun there is nothing to stub; the tests that keep running here never
    // reach extraction, so an empty recorder states exactly that.
    if (NEEDS_BUN) return { cmds, restore: () => {} };
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
    own: <T>(value: T) => value,
    disown: () => {},
  } as unknown as Parameters<BootstrapDownloadTask["execute"]>[1];

  it.skipIf(NEEDS_BUN)(
    "sends no conditional header on a first run and records a marker",
    async () => {
      const { folder, targetFolder } = setup();
      const task = new TestBootstrapDownloadTask({ defaults: { url: URL, targetFolder } });
      task.response = { etag: '"abc"', lastModified: "Fri, 31 Jul 2026 04:40:43 GMT" };
      const bun = stubBun();
      try {
        const input = { url: URL, targetFolder };
        await task.execute(input, ctx);

        expect(task.seenHeaders[0]["If-None-Match"]).toBeUndefined();
        const marker = JSON.parse(
          readFileSync(path.join(folder, ".bulk-done", `${targetFolder}.json`), "utf8")
        );
        expect(marker.etag).toBe('"abc"');
        expect(marker.contentLength).toBe(4);
        expect(marker.url).toBe(URL);
      } finally {
        bun.restore();
        rmSync(folder, { recursive: true, force: true });
      }
    }
  );

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
        // Deliberately NOT the 4 bytes a 200 would write: the belt-and-braces
        // "same ETag and length" branch below skips extraction too, so with a
        // matching length this test would pass whether the 304 was honored or
        // silently downloaded. A mismatched length leaves the real 304 path as
        // the only way to reach a skip.
        contentLength: 999,
        extractedAt: "2026-07-31",
      })
    );
    const task = new TestBootstrapDownloadTask({ defaults: { url: URL, targetFolder } });
    task.response = { status: 304, etag: '"abc"' };
    const bun = stubBun();
    try {
      const input = { url: URL, targetFolder };
      const result = await task.execute(input, ctx);

      expect(result.success).toBe(true);
      expect(task.seenHeaders[0]["If-None-Match"]).toBe('"abc"');
      expect(task.seenHeaders[0]["If-Modified-Since"]).toBe("Fri, 31 Jul 2026 04:40:43 GMT");
      expect(bun.cmds).toHaveLength(0); // never unzipped
      // A 304 carries no body, so the sink never opened its file: the extracted
      // tree the conditional request just certified as current is untouched,
      // and no zero-byte archive was staged over it.
      expect(readFileSync(path.join(targetDir, "already-here.json"), "utf8")).toBe("{}");
      expect(existsSync(path.join(folder, `${targetFolder}.zip`))).toBe(false);
    } finally {
      bun.restore();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it.skipIf(NEEDS_BUN)("ignores a marker whose extracted tree is gone", async () => {
    const { folder, targetFolder } = setup();
    mkdirSync(path.join(folder, ".bulk-done"), { recursive: true });
    writeFileSync(
      path.join(folder, ".bulk-done", `${targetFolder}.json`),
      JSON.stringify({ url: URL, etag: '"abc"', contentLength: 4, extractedAt: "2026-07-31" })
    );
    const task = new TestBootstrapDownloadTask({ defaults: { url: URL, targetFolder } });
    task.response = { etag: '"def"' };
    const bun = stubBun();
    try {
      const input = { url: URL, targetFolder };
      await task.execute(input, ctx);

      // No target dir contents => marker untrusted => unconditional download.
      expect(task.seenHeaders[0]["If-None-Match"]).toBeUndefined();
      expect(bun.cmds).toHaveLength(1);
    } finally {
      bun.restore();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it.skipIf(NEEDS_BUN)(
    "extracts with -uo normally and -o under force, and force skips the marker",
    async () => {
      const { folder, targetFolder, targetDir } = setup();
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(path.join(targetDir, "already-here.json"), "{}");
      mkdirSync(path.join(folder, ".bulk-done"), { recursive: true });
      writeFileSync(
        path.join(folder, ".bulk-done", `${targetFolder}.json`),
        JSON.stringify({ url: URL, etag: '"abc"', contentLength: 4, extractedAt: "2026-07-31" })
      );
      const task = new TestBootstrapDownloadTask({ defaults: { url: URL, targetFolder } });
      task.response = { etag: '"changed"' };
      const bun = stubBun();
      try {
        const plain = { url: URL, targetFolder };
        await task.execute(plain, ctx);
        expect(bun.cmds[0]).toContain("-uo");
        expect(task.seenHeaders[0]["If-None-Match"]).toBe('"abc"');

        const forced = { url: URL, targetFolder, force: true };
        await task.execute(forced, ctx);
        expect(bun.cmds[1]).toContain("-o");
        expect(bun.cmds[1]).not.toContain("-uo");
        expect(task.seenHeaders[1]["If-None-Match"]).toBeUndefined();
      } finally {
        bun.restore();
        rmSync(folder, { recursive: true, force: true });
      }
    }
  );

  it("refuses to extract when a 200 comes back with no body at all", async () => {
    // The sink reports `wrote: false` and leaves `zipPath` alone. Extracting
    // anyway would republish whatever an earlier run left there AND stamp the
    // marker with this response's validators, freezing the staleness in.
    const { folder, targetFolder, zipPath } = setup();
    writeFileSync(zipPath, "an earlier run's archive");
    const task = new TestBootstrapDownloadTask({ defaults: { url: URL, targetFolder } });
    task.response = { emptyBody: true, etag: '"abc"' };
    const bun = stubBun();
    try {
      await expect(task.execute({ url: URL, targetFolder }, ctx)).rejects.toThrow(/no body/);
      expect(bun.cmds).toHaveLength(0);
      expect(existsSync(path.join(folder, ".bulk-done", `${targetFolder}.json`))).toBe(false);
      expect(readFileSync(zipPath, "utf8")).toBe("an earlier run's archive");
    } finally {
      bun.restore();
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
    const task = new TestBootstrapDownloadTask({ defaults: { url: URL, targetFolder } });
    task.response = { etag: '"abc"' };
    const bun = stubBun();
    try {
      const input = { url: URL, targetFolder };
      const result = await task.execute(input, ctx);

      expect(result.success).toBe(true);
      expect(bun.cmds).toHaveLength(0);
      expect(existsSync(zipPath)).toBe(false); // staged zip binned
    } finally {
      bun.restore();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

/**
 * The marker path mirrors the target folder, and a period-scoped ADV download
 * targets a nested one (`adv/2026-07`). Creating only `.bulk-done` left the
 * write with nowhere to land, so a download that had already spent its bytes
 * failed at the last step and re-downloaded on every run.
 */
describe("bulk archive markers for a nested target folder", () => {
  it("round-trips a marker whose target folder has a path segment", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "sec-marker-test-"));
    try {
      const marker = {
        url: "https://example/adv-2026-07.zip",
        etag: '"abc"',
        contentLength: 4,
        extractedAt: "2026-08-01T00:00:00.000Z",
      };
      writeBulkArchiveMarker(folder, "adv/2026-07", marker);

      expect(readBulkArchiveMarker(folder, "adv/2026-07")).toEqual(marker);
      // Each period keeps its own marker, so one month's validators can never
      // certify another month's extraction as current.
      expect(readBulkArchiveMarker(folder, "adv/2026-06")).toBeUndefined();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
