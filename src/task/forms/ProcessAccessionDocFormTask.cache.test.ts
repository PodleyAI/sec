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
import { stripXslPrefix } from "../../util/accessionDocPath";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";
import { SecFetchAccessionDocTask } from "./SecFetchAccessionDocTask";

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

  it("hits the cache for an xsl-prefixed primary_doc (ownership forms 3/4/5)", async () => {
    // Forms 3/4/5 carry the EDGAR inline-XBRL viewer prefix in `primary_doc`
    // ("xslF345X03/wf-form4.xml"). Every path that composes a cache location
    // strips it first, so the cached document lives under the bare filename —
    // the read must strip too or these filings never hit cache and re-fetch
    // through the rate-limited queue on every run.
    const cik = 1234;
    const accession = "0001999999-25-000003";
    const rawPrimaryDoc = "xslF345X03/wf-form4.xml";

    // Prime the cache at exactly the location the write path composes, using
    // the write path's own filename mapper rather than a hand-built string.
    const relative = new SecFetchAccessionDocTask({
      cik,
      accessionNumber: accession,
      fileName: stripXslPrefix(rawPrimaryDoc),
    }).inputToFileName({
      cik,
      accessionNumber: accession,
      fileName: stripXslPrefix(rawPrimaryDoc),
    });
    const fullPath = path.join(root!, relative);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, "FORM 4 XML BODY");

    const text = await new ExposedTask().runFetchPublic(
      cik,
      accession,
      rawPrimaryDoc,
      {} as IExecuteContext
    );
    expect(text).toBe("FORM 4 XML BODY");
  });

  it("still treats a traversal-shaped primary_doc as a silent cache miss", async () => {
    // Stripping a known-safe prefix must not open a hole: whatever survives the
    // strip still goes through the traversal guard, and a rejection stays a
    // silent miss (fall through to the network) rather than reading outside the
    // accession-doc directory.
    writeFileSync(path.join(root!, "outside-secret.txt"), "SECRET");
    const dir = path.join(root!, "accessiondocs", "0000009999");
    mkdirSync(dir, { recursive: true });

    for (const evil of [
      "../../outside-secret.txt",
      "xslF345X03/../../outside-secret.txt",
      "/etc/passwd",
    ]) {
      await expect(
        new ExposedTask().runFetchPublic(9999, "0001999999-25-000004", evil, {} as IExecuteContext)
      ).rejects.toBeDefined();
    }
  });
});
