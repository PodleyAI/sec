/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

// Exposes the protected runFetch so we can prove the cache fast-path is taken.
class ExposedTask extends ProcessAccessionDocFormTask {
  static readonly type = "ExposedRunFetchTask";
  public runFetchPublic(
    cik: number,
    accession: string,
    fileName: string,
    ctx: IExecuteContext
  ): Promise<string> {
    return this.runFetch(cik, accession, fileName, ctx);
  }
}

describe("runFetch on-disk cache fast-path", () => {
  let root: string | undefined;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    root = mkdtempSync(path.join(tmpdir(), "sec-fetchcache-"));
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("returns a cached primary document from disk without touching the queue", async () => {
    // Cache path must mirror SecFetchAccessionDocTask.inputToFileName exactly:
    // accessiondocs/<0-padded cik>/<accession w/o dashes>-<fileName>
    const cik = 1234;
    const accession = "0001999999-25-000001";
    const fileName = "doc.htm";
    const dir = path.join(root!, "accessiondocs", "0000001234");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "000199999925000001-doc.htm"), "HELLO DOC BODY");

    // No job queue is registered in this test. If runFetch fell through to the
    // network/queue path it would hang or throw — so returning the file body
    // proves the cache fast-path was taken (queue bypassed).
    const text = await new ExposedTask().runFetchPublic(
      cik,
      accession,
      fileName,
      {} as IExecuteContext
    );
    expect(text).toBe("HELLO DOC BODY");
  });

  it("treats an empty cache file as a miss (falls through, not served as empty)", async () => {
    // A 0-byte cache entry must not be served — runFetch's `length > 0` guard
    // falls through to the (here unavailable) network path, so this rejects
    // rather than returning "". Proves we don't mistake an empty file for a hit.
    const dir = path.join(root!, "accessiondocs", "0000005678");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "000199999925000002-x.htm"), "");

    await expect(
      new ExposedTask().runFetchPublic(5678, "0001999999-25-000002", "x.htm", {} as IExecuteContext)
    ).rejects.toBeDefined();
  });
});
