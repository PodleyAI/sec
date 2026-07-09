/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
});
