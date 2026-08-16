/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SecFetchFileOutputCache } from "./SecFetchFileOutputCache";

describe("SecFetchFileOutputCache path safety", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "sec-cache-test-"));
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeCache(inputToFileName: (input: any) => string): SecFetchFileOutputCache {
    return new SecFetchFileOutputCache({
      folderPath: tmpRoot,
      inputToFileName,
    });
  }

  it("rejects relative paths that escape via ../ segments on save", async () => {
    // Regression: inputToFileName values come from SEC-supplied data
    // (primary_doc, accession numbers). A single malformed value with
    // '../' segments would let a fetch write outside SEC_RAW_DATA_FOLDER.
    const cache = makeCache(() => "../escape/oops.json");
    await expect(
      cache.saveOutput("T", { response_type: "json" }, { json: { ok: true } })
    ).rejects.toThrow(/outside cache folder/);
  });

  it("rejects absolute paths on save", async () => {
    const cache = makeCache(() => "/etc/passwd");
    await expect(cache.saveOutput("T", { response_type: "text" }, { text: "hi" })).rejects.toThrow(
      /outside cache folder/
    );
  });

  it("rejects relative paths that escape via ../ segments on read", async () => {
    const cache = makeCache(() => "../escape/oops.json");
    await expect(cache.getOutput("T", { response_type: "json" })).rejects.toThrow(
      /outside cache folder/
    );
  });

  it("allows legitimate nested subdirectory paths", async () => {
    const cache = makeCache(() => "subdir/inner/legit.txt");
    await cache.saveOutput("T", { response_type: "text" }, { text: "hello" });
    const written = readFileSync(path.join(tmpRoot, "subdir/inner/legit.txt"), "utf-8");
    expect(written).toBe("hello");
  });

  it("allows filenames that start with .. but don't escape", async () => {
    // Regression: a plain startsWith("..") check would reject names like
    // "..foo.txt" because path.relative returns "..foo.txt" verbatim.
    // The fix anchors on path separators (and the exact ".." case) so
    // these legitimate filenames pass.
    const cache = makeCache(() => "..foo.txt");
    await cache.saveOutput("T", { response_type: "text" }, { text: "ok" });
    expect(readFileSync(path.join(tmpRoot, "..foo.txt"), "utf-8")).toBe("ok");
  });

  it("round-trips an arraybuffer output as binary (regression: ZIP downloads)", async () => {
    // Before the fix, response_type "arraybuffer" fell through to "assuming
    // text" and wrote output.text (undefined), corrupting/aborting every binary
    // download (e.g. the Form ADV archive ZIPs). Non-UTF8 bytes must survive.
    const cache = makeCache(() => "bin/archive.zip");
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0x01, 0xfe]);
    await cache.saveOutput("T", { response_type: "arraybuffer" }, { arraybuffer: bytes.buffer });
    const out = await cache.getOutput("T", { response_type: "arraybuffer" });
    expect(out?.arraybuffer).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(out!.arraybuffer as ArrayBuffer)).toEqual(bytes);
  });

  it("reports streaming support once the port writer exists", () => {
    // The single capability probe the cache coordinator keys its binary sinks
    // on: without a writer no sec fetch gets a sink and "stream" has nowhere
    // to land.
    expect(makeCache(() => "a/b.txt").supportsStreaming()).toBe(true);
  });

  it("writes streamed bytes to the same path saveOutput would use", async () => {
    // Load-bearing across commands: inputToFileName ignores response_type, so
    // a "stream" fill by `sec spac download` and a later "text" read of the
    // same document must address one entry.
    const cache = makeCache(() => "cik/doc.htm");
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array([104, 105]); // "hi"
    }
    const ref = await cache.saveOutputStreamPort(
      "SecFetchAccessionDocTask",
      { url: "https://x", response_type: "stream" },
      "body",
      "binary",
      chunks(),
      {}
    );
    expect(ref.$ref).toBe(path.join(tmpRoot, "cik/doc.htm"));
    expect(ref.size).toBe(2);
    expect(readFileSync(path.join(tmpRoot, "cik/doc.htm"), "utf-8")).toBe("hi");
    expect(await cache.getOutputByRef(ref)).toBeInstanceOf(Blob);
  });

  it("streams bytes verbatim rather than through a UTF-8 re-encode", async () => {
    // The reason a streamed copy is interchangeable with (in fact better than)
    // the text path's: `.text` substitutes U+FFFD for invalid sequences, so a
    // document with non-UTF-8 bytes survives only on this path.
    const cache = makeCache(() => "cik/binary.htm");
    const bytes = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0xff, 0xfe, 0x3e]);
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield bytes;
    }
    await cache.saveOutputStreamPort(
      "T",
      { response_type: "stream" },
      "body",
      "binary",
      chunks(),
      {}
    );
    expect(new Uint8Array(readFileSync(path.join(tmpRoot, "cik/binary.htm")))).toEqual(bytes);
  });

  it("leaves no file and no tmp sibling behind when the stream errors", async () => {
    // A renamed partial is worse than nothing: the next run reads the stump as
    // a complete document with nothing marking it short.
    const cache = makeCache(() => "cik/bad.htm");
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array([1]);
      throw new Error("peer reset");
    }
    await expect(
      cache.saveOutputStreamPort("T", { response_type: "stream" }, "body", "binary", chunks(), {})
    ).rejects.toThrow("peer reset");
    expect(existsSync(path.join(tmpRoot, "cik/bad.htm"))).toBe(false);
    expect(readdirSync(path.join(tmpRoot, "cik")).filter((f) => f.includes(".tmp."))).toEqual([]);
  });

  it("refuses a streamed write whose file name escapes the cache folder", async () => {
    const cache = makeCache(() => "../escape/streamed.bin");
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array([1]);
    }
    await expect(
      cache.saveOutputStreamPort("T", { response_type: "stream" }, "body", "binary", chunks(), {})
    ).rejects.toThrow(/outside cache folder/);
  });

  it("does not overwrite the streamed bytes when the row save follows", async () => {
    // saveByPolicy runs after the sink and targets this same path. Re-writing
    // here would replace the origin's bytes with a re-encode of the value
    // derived from them — and for "stream", with an empty file.
    const cache = makeCache(() => "cik/streamed.htm");
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array([104, 105]);
    }
    const ref = await cache.saveOutputStreamPort(
      "T",
      { response_type: "stream" },
      "body",
      "binary",
      chunks(),
      {}
    );
    await cache.saveOutput("T", { response_type: "stream" }, { body: ref });
    expect(readFileSync(path.join(tmpRoot, "cik/streamed.htm"), "utf-8")).toBe("hi");

    // Same for a materializing type whose body came back as a ref.
    await cache.saveOutput("T", { response_type: "text" }, { body: ref, text: "REPLACED" });
    expect(readFileSync(path.join(tmpRoot, "cik/streamed.htm"), "utf-8")).toBe("hi");
  });

  it("reports a cache MISS for an unknown response_type rather than an empty hit", async () => {
    // An empty hit reads downstream as "the document was empty" — the fetch is
    // skipped and the caller parses nothing.
    const cache = makeCache(() => "cik/known.txt");
    await cache.saveOutput("T", { response_type: "text" }, { text: "body" });
    expect(await cache.getOutput("T", { response_type: "nonsense" })).toBeUndefined();
  });

  it("reports a cache HIT carrying nothing for a stream read of a present file", async () => {
    const cache = makeCache(() => "cik/present.txt");
    await cache.saveOutput("T", { response_type: "text" }, { text: "body" });
    expect(await cache.getOutput("T", { response_type: "stream" })).toEqual({});
  });

  it("answers a stream read without reading the file", async () => {
    // A directory is stat-able but not readable, so it separates the two: with
    // a readFile in the path this raises EISDIR, which is not the ENOENT the
    // miss branch swallows. Materializing the bytes here would defeat the one
    // thing "stream" is for — the deserializer answers {} without them.
    const cache = makeCache(() => "cik/statonly");
    mkdirSync(path.join(tmpRoot, "cik/statonly"), { recursive: true });
    expect(await cache.getOutput("T", { response_type: "stream" })).toEqual({});
  });

  it("reports a cache MISS for a stream read when the entry is absent", async () => {
    const cache = makeCache(() => "cik/never-written.txt");
    expect(await cache.getOutput("T", { response_type: "stream" })).toBeUndefined();
  });
});
