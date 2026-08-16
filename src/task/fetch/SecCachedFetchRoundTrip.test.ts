/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "workglow";
import type { SafeFetchFn } from "workglow";
import { globalServiceRegistry, registerSafeFetch } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { SecCachedFetchTask } from "./SecCachedFetchTask";

/**
 * End-to-end cover for every `SecCachedFetchTask` subclass at once — sec's
 * seven, plus embarc-data's ADV archive fetch, which all reach the network
 * through this one base.
 *
 * It exists because implementing `saveOutputStreamPort` changed the write path
 * under all of them without changing a line they own: the cache now reports
 * `supportsStreaming()`, so the runner streams `body` to a per-port sink and
 * the row save that used to write the file is skipped. The derived port a
 * caller reads (`.text`, `.arraybuffer`) and the bytes that land at
 * `inputToFileName` both have to survive that, and neither is checked by a unit
 * test of the cache in isolation.
 */
interface DocInput {
  readonly name: string;
  readonly response_type?: "stream" | "text" | "json" | "blob" | "arraybuffer";
}

class TestCachedFetchTask extends SecCachedFetchTask<DocInput> {
  static readonly type = "TestCachedFetchTask";
  static readonly category = "Hidden";
  static readonly title = "Test cached fetch";

  inputToFileName(input: DocInput): string {
    return `docs/${input.name}`;
  }
  inputToUrl(input: DocInput): string {
    return `https://www.sec.gov/Archives/${input.name}`;
  }
}

let raw: string;
let restoreFetch: SafeFetchFn;

function serve(body: Uint8Array, contentType: string): SafeFetchFn {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": contentType, "content-length": String(body.byteLength) },
    })) as unknown as SafeFetchFn;
}

beforeEach(() => {
  resetDependencyInjectionsForTesting();
  raw = mkdtempSync(path.join(tmpdir(), "sec-cached-roundtrip-"));
  globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, raw);
});

afterEach(() => {
  registerSafeFetch(restoreFetch);
  rmSync(raw, { recursive: true, force: true });
  resetDependencyInjectionsForTesting();
});

describe("SecCachedFetchTask round trip with the streaming sink live", () => {
  it("returns .text AND leaves the document at the cache path", async () => {
    restoreFetch = registerSafeFetch(
      serve(new TextEncoder().encode("<html>ok</html>"), "text/html")
    );

    const task = new TestCachedFetchTask({ name: "doc.htm" });
    const out = await task.run();

    expect(out.text).toBe("<html>ok</html>");
    expect(readFileSync(path.join(raw, "docs/doc.htm"), "utf-8")).toBe("<html>ok</html>");
    // The sink renames into place, so no writer's scratch file survives.
    expect(readdirSync(path.join(raw, "docs")).filter((f) => f.includes(".tmp."))).toEqual([]);
  });

  it("returns .arraybuffer AND writes the origin's bytes verbatim", async () => {
    // The shape embarc-data's ADV archive fetch uses — it states the type
    // explicitly, which is what makes it `arraybuffer` rather than the `blob`
    // the extension mapping would otherwise pick for a `.zip`. Non-UTF-8 bytes
    // make the point: whatever writes the file must not route them through a
    // text encode, or a zip becomes unreadable.
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0xfe]);
    restoreFetch = registerSafeFetch(serve(bytes, "application/zip"));

    const task = new TestCachedFetchTask({ name: "archive.zip", response_type: "arraybuffer" });
    const out = await task.run();

    expect(new Uint8Array(out.arraybuffer as ArrayBuffer)).toEqual(bytes);
    expect(new Uint8Array(readFileSync(path.join(raw, "docs/archive.zip")))).toEqual(bytes);
  });

  it("serves the second fetch from the cache without touching the network", async () => {
    let calls = 0;
    restoreFetch = registerSafeFetch((async () => {
      calls += 1;
      return new Response(new TextEncoder().encode("cached body"), {
        status: 200,
        headers: { "content-type": "text/html", "content-length": "11" },
      });
    }) as unknown as SafeFetchFn);

    expect((await new TestCachedFetchTask({ name: "hit.htm" }).run()).text).toBe("cached body");
    expect(calls).toBe(1);

    expect((await new TestCachedFetchTask({ name: "hit.htm" }).run()).text).toBe("cached body");
    expect(calls).toBe(1);
  });

  it('fills the same cache path from a "stream" fetch, materializing nothing', async () => {
    // The property `sec spac download` depends on: inputToFileName ignores
    // response_type, so a bytes-only fill and a later text read address one
    // entry. A "stream" fetch materializes no derived port — success is the
    // file being there.
    restoreFetch = registerSafeFetch(serve(new TextEncoder().encode("streamed body"), "text/html"));

    const out = await new TestCachedFetchTask({
      name: "streamed.htm",
      response_type: "stream",
    }).run();

    expect(out.text).toBeUndefined();
    expect(readFileSync(path.join(raw, "docs/streamed.htm"), "utf-8")).toBe("streamed body");
  });

  it("reads back a stream-filled document as text on the next fetch", async () => {
    let calls = 0;
    restoreFetch = registerSafeFetch((async () => {
      calls += 1;
      return new Response(new TextEncoder().encode("filled by stream"), {
        status: 200,
        headers: { "content-type": "text/html", "content-length": "16" },
      });
    }) as unknown as SafeFetchFn);

    await new TestCachedFetchTask({ name: "shared.htm", response_type: "stream" }).run();
    expect(calls).toBe(1);

    // The forms sweep's ordinary text fetch of the same document: one entry,
    // one download.
    const out = await new TestCachedFetchTask({ name: "shared.htm" }).run();
    expect(out.text).toBe("filled by stream");
    expect(calls).toBe(1);
  });

  it("writes no cache entry when the fetch fails", async () => {
    restoreFetch = registerSafeFetch(
      (async () =>
        new Response("nope", { status: 404, statusText: "Not Found" })) as unknown as SafeFetchFn
    );

    await expect(new TestCachedFetchTask({ name: "missing.htm" }).run()).rejects.toThrow();
    expect(existsSync(path.join(raw, "docs/missing.htm"))).toBe(false);
  });
});
