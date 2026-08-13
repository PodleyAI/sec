/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DRY_RUN, SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../../storage/filing/FilingSchema";
import {
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  type SpacCandidate,
  type SpacCandidateConfidence,
} from "../../storage/spac/SpacCandidateSchema";
import { accessionDocCacheRelative } from "./spacCandidateDownload";
import {
  CacheOneSpacCandidateDocTask,
  DownloadSpacCandidateDocsTask,
  type DownloadSpacCandidateDocsTaskInput,
} from "./DownloadSpacCandidateDocsTask";

const EIGHT_K_HTML = [
  "<DOCUMENT>",
  "<TYPE>8-K",
  "<FILENAME>d8k.htm",
  "<TEXT>",
  "<html>ok</html>",
  "</TEXT>",
  "</DOCUMENT>",
].join("\n");

const EIGHT_K_PDF = [
  "<DOCUMENT>",
  "<TYPE>8-K",
  "<FILENAME>d8k.pdf",
  "<TEXT>",
  "<PDF>",
  "binary",
  "</PDF>",
  "</TEXT>",
  "</DOCUMENT>",
].join("\n");

function ctx(): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: () => {},
    own: <T>(value: T) => value,
    disown: () => {},
  } as unknown as IExecuteContext;
}

function filing(
  partial: Partial<Filing> & Pick<Filing, "cik" | "accession_number" | "form">
): Filing {
  return {
    report_date: null,
    acceptance_date: "2021-03-05T12:00:00.000Z",
    file_number: null,
    film_number: null,
    primary_doc: "doc.htm",
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
    filing_date: "2021-03-05",
    ...partial,
  } as Filing;
}

function candidate(
  cik: number,
  confidence: SpacCandidateConfidence,
  extra: Partial<SpacCandidate> = {}
): SpacCandidate {
  return {
    cik,
    name: `Test Acquisition ${cik}`,
    current_sic: 6770,
    signal_sic_6770: true,
    signal_name_match: true,
    signal_renamed_from: null,
    first_reg_form: "S-1",
    first_reg_date: "2021-01-05",
    reg_while_spac_named: true,
    confidence,
    identified_at: "2026-08-01T00:00:00.000Z",
    ...extra,
  };
}

class TestCacheOne extends CacheOneSpacCandidateDocTask {
  static requested: string[] = [];
  static docs = new Map<string, string | Error>();
  /**
   * Whether the cache file still existed when the fetch was entered. The real
   * fetch task's output cache keys off exactly this path and is consulted
   * BEFORE its `execute`, so a `true` here is the state in which a `--force`
   * re-fetch silently short-circuits back to the file it meant to replace.
   */
  static cacheExistedAtFetch = new Map<string, boolean>();

  protected override async fetchDoc(
    cik: number,
    accessionNumber: string,
    fileName: string,
    _context: IExecuteContext
  ): Promise<string> {
    const key = `${cik}/${accessionNumber}/${fileName}`;
    TestCacheOne.requested.push(key);
    TestCacheOne.cacheExistedAtFetch.set(key, existsSync(cachePath(cik, accessionNumber, fileName)));
    const v = TestCacheOne.docs.get(key);
    if (v instanceof Error) throw v;
    if (typeof v !== "string") throw new Error(`unexpected fetch ${key}`);
    return v;
  }
}

class TestDownload extends DownloadSpacCandidateDocsTask {
  protected override createInnerTask(force: boolean): CacheOneSpacCandidateDocTask {
    return new TestCacheOne({ defaults: { force } });
  }
}

let raw: string;

beforeEach(async () => {
  resetDependencyInjectionsForTesting();
  await setupAllDatabases();
  raw = mkdtempSync(path.join(tmpdir(), "sec-spacdocs-test-"));
  globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, raw);
  TestCacheOne.requested = [];
  TestCacheOne.docs = new Map();
  TestCacheOne.cacheExistedAtFetch = new Map();
});

afterEach(() => {
  rmSync(raw, { recursive: true, force: true });
  resetDependencyInjectionsForTesting();
});

function cachePath(cik: number, acc: string, fileName: string): string {
  return path.join(raw, accessionDocCacheRelative(cik, acc, fileName));
}

function writeCache(cik: number, acc: string, fileName: string, body: string): void {
  const full = cachePath(cik, acc, fileName);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body, "utf-8");
}

async function runDownload(
  input: DownloadSpacCandidateDocsTaskInput
): Promise<Awaited<ReturnType<DownloadSpacCandidateDocsTask["execute"]>>> {
  return new TestDownload().execute(input, ctx());
}

describe("DownloadSpacCandidateDocsTask", () => {
  it("throws when spac_candidate is empty", async () => {
    await expect(runDownload({ set: "registration" })).rejects.toThrow(/sec update spacs/);
  });

  it("throws when SEC_RAW_DATA_FOLDER is not registered", async () => {
    globalServiceRegistry.container.remove(SEC_RAW_DATA_FOLDER.id);
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put(candidate(1, "high"));
    await expect(runDownload({ set: "registration" })).rejects.toThrow(/SEC_RAW_DATA_FOLDER/);
  });

  it("defaults to high and medium, dropping low", async () => {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).putBulk([
      candidate(1, "high"),
      candidate(2, "medium"),
      candidate(3, "low"),
    ]);
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).putBulk([
      filing({ cik: 1, accession_number: "0000000001-21-000001", form: "S-1" }),
      filing({ cik: 2, accession_number: "0000000002-21-000001", form: "S-1" }),
      filing({ cik: 3, accession_number: "0000000003-21-000001", form: "S-1" }),
    ]);
    TestCacheOne.docs.set("1/0000000001-21-000001/0000000001-21-000001.txt", "s1-1");
    TestCacheOne.docs.set("2/0000000002-21-000001/0000000002-21-000001.txt", "s1-2");

    const out = await runDownload({ set: "registration" });
    expect(out.candidates).toBe(2);
    expect(out.matched).toBe(2);
    expect(out.downloaded).toBe(2);
    expect(TestCacheOne.requested.some((k) => k.startsWith("3/"))).toBe(false);
  });

  it("honors an explicit high-only confidence filter", async () => {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).putBulk([
      candidate(1, "high"),
      candidate(2, "medium"),
    ]);
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).putBulk([
      filing({ cik: 1, accession_number: "0000000001-21-000001", form: "S-1" }),
      filing({ cik: 2, accession_number: "0000000002-21-000001", form: "S-1" }),
    ]);
    TestCacheOne.docs.set("1/0000000001-21-000001/0000000001-21-000001.txt", "s1-1");

    const out = await runDownload({ set: "registration", confidence: ["high"] });
    expect(out.candidates).toBe(1);
    expect(out.matched).toBe(1);
    expect(out.downloaded).toBe(1);
  });

  it("registration matches S-1 not 10-K; all keeps both; 8k matches 8-K", async () => {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put(candidate(1, "high"));
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).putBulk([
      filing({ cik: 1, accession_number: "acc-s1", form: "S-1", primary_doc: "s1.htm" }),
      filing({ cik: 1, accession_number: "acc-10k", form: "10-K", primary_doc: "d10k.htm" }),
      filing({ cik: 1, accession_number: "acc-8k", form: "8-K", primary_doc: "d8k.htm" }),
    ]);
    TestCacheOne.docs.set("1/acc-s1/acc-s1.txt", "s1");
    TestCacheOne.docs.set("1/acc-10k/d10k.htm", "10k");
    TestCacheOne.docs.set("1/acc-8k/acc-8k.txt", EIGHT_K_HTML);

    const reg = await runDownload({ set: "registration" });
    expect(reg.matched).toBe(1);

    TestCacheOne.requested = [];
    const eight = await runDownload({ set: "8k" });
    expect(eight.matched).toBe(1);

    TestCacheOne.requested = [];
    const all = await runDownload({ set: "all" });
    expect(all.matched).toBe(3);
  });

  it("skips an already-cached required file and does not fetch", async () => {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put(candidate(1, "high"));
    await globalServiceRegistry
      .get(FILING_REPOSITORY_TOKEN)
      .put(filing({ cik: 1, accession_number: "0000000001-21-000001", form: "S-1" }));
    writeCache(1, "0000000001-21-000001", "0000000001-21-000001.txt", "cached");

    const out = await runDownload({ set: "registration" });
    expect(out.matched).toBe(1);
    expect(out.skipped).toBe(1);
    expect(out.downloaded).toBe(0);
    expect(TestCacheOne.requested).toEqual([]);
  });

  it("re-fetches a cached file when force is set", async () => {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put(candidate(1, "high"));
    await globalServiceRegistry
      .get(FILING_REPOSITORY_TOKEN)
      .put(filing({ cik: 1, accession_number: "0000000001-21-000001", form: "S-1" }));
    writeCache(1, "0000000001-21-000001", "0000000001-21-000001.txt", "old");
    TestCacheOne.docs.set("1/0000000001-21-000001/0000000001-21-000001.txt", "new");

    const out = await runDownload({ set: "registration", force: true });
    expect(out.skipped).toBe(0);
    expect(out.downloaded).toBe(1);
    expect(readFileSync(cachePath(1, "0000000001-21-000001", "0000000001-21-000001.txt"), "utf-8")).toBe(
      "new"
    );
  });

  it("force deletes the cache entry BEFORE fetching, so the fetch cannot be served from it", async () => {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put(candidate(1, "high"));
    await globalServiceRegistry
      .get(FILING_REPOSITORY_TOKEN)
      .put(filing({ cik: 1, accession_number: "acc-force", form: "S-1" }));
    writeCache(1, "acc-force", "acc-force.txt", "old");
    TestCacheOne.docs.set("1/acc-force/acc-force.txt", "new");

    await runDownload({ set: "registration", force: true });
    // The real fetch task consults its file cache at this exact path before
    // running, so `true` here means `--force` never re-downloads anything.
    expect(TestCacheOne.cacheExistedAtFetch.get("1/acc-force/acc-force.txt")).toBe(false);
  });

  it("force replaces a corrupt cache entry with the fetched bytes", async () => {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put(candidate(1, "high"));
    await globalServiceRegistry
      .get(FILING_REPOSITORY_TOKEN)
      .put(filing({ cik: 1, accession_number: "acc-corrupt", form: "S-1" }));
    writeCache(1, "acc-corrupt", "acc-corrupt.txt", "CORRUPT");
    TestCacheOne.docs.set("1/acc-corrupt/acc-corrupt.txt", "<SEC-DOCUMENT>good</SEC-DOCUMENT>");

    const out = await runDownload({ set: "registration", force: true });
    expect(out.downloaded).toBe(1);
    expect(readFileSync(cachePath(1, "acc-corrupt", "acc-corrupt.txt"), "utf-8")).toBe(
      "<SEC-DOCUMENT>good</SEC-DOCUMENT>"
    );
  });

  it("leaves no partial tmp files behind after a forced 8-K run", async () => {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put(candidate(1, "high"));
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put(
      filing({
        cik: 1,
        accession_number: "acc-8k-force",
        form: "8-K",
        primary_doc: "d8k.htm",
      })
    );
    writeCache(1, "acc-8k-force", "acc-8k-force.txt", "CORRUPT");
    writeCache(1, "acc-8k-force", "d8k.htm", "CORRUPT");
    TestCacheOne.docs.set("1/acc-8k-force/acc-8k-force.txt", EIGHT_K_HTML);

    await runDownload({ set: "8k", force: true });
    const cikDir = path.dirname(cachePath(1, "acc-8k-force", "d8k.htm"));
    expect(readdirSync(cikDir).filter((f) => f.includes(".tmp."))).toEqual([]);
    expect(readFileSync(cachePath(1, "acc-8k-force", "acc-8k-force.txt"), "utf-8")).toBe(
      EIGHT_K_HTML
    );
    expect(readFileSync(cachePath(1, "acc-8k-force", "d8k.htm"), "utf-8")).toBe("<html>ok</html>");
  });

  it("writes the 8-K full submission and a sliced primary from one fetch", async () => {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put(candidate(1, "high"));
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put(
      filing({
        cik: 1,
        accession_number: "0000000001-21-000008",
        form: "8-K",
        primary_doc: "d8k.htm",
      })
    );
    TestCacheOne.docs.set("1/0000000001-21-000008/0000000001-21-000008.txt", EIGHT_K_HTML);

    const out = await runDownload({ set: "8k" });
    expect(out.downloaded).toBe(1);
    expect(TestCacheOne.requested).toEqual([
      "1/0000000001-21-000008/0000000001-21-000008.txt",
    ]);
    expect(
      readFileSync(cachePath(1, "0000000001-21-000008", "0000000001-21-000008.txt"), "utf-8")
    ).toBe(EIGHT_K_HTML);
    expect(readFileSync(cachePath(1, "0000000001-21-000008", "d8k.htm"), "utf-8")).toBe(
      "<html>ok</html>"
    );
  });

  it("writes only the 8-K txt when the primary cannot be sliced", async () => {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put(candidate(1, "high"));
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put(
      filing({
        cik: 1,
        accession_number: "0000000001-21-000009",
        form: "8-K",
        primary_doc: "d8k.pdf",
      })
    );
    TestCacheOne.docs.set("1/0000000001-21-000009/0000000001-21-000009.txt", EIGHT_K_PDF);

    await runDownload({ set: "8k" });
    expect(existsSync(cachePath(1, "0000000001-21-000009", "0000000001-21-000009.txt"))).toBe(true);
    expect(existsSync(cachePath(1, "0000000001-21-000009", "d8k.pdf"))).toBe(false);
  });

  it("slices a missing 8-K primary from a cached txt without fetching", async () => {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put(candidate(1, "high"));
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put(
      filing({
        cik: 1,
        accession_number: "0000000001-21-000008",
        form: "8-K",
        primary_doc: "d8k.htm",
      })
    );
    writeCache(1, "0000000001-21-000008", "0000000001-21-000008.txt", EIGHT_K_HTML);

    const out = await runDownload({ set: "8k" });
    expect(out.downloaded).toBe(1);
    expect(TestCacheOne.requested).toEqual([]);
    expect(readFileSync(cachePath(1, "0000000001-21-000008", "d8k.htm"), "utf-8")).toBe(
      "<html>ok</html>"
    );
  });

  it("dry-run reports counts and writes nothing", async () => {
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put(candidate(1, "high"));
    await globalServiceRegistry
      .get(FILING_REPOSITORY_TOKEN)
      .put(filing({ cik: 1, accession_number: "0000000001-21-000001", form: "S-1" }));

    const out = await runDownload({ set: "registration" });
    expect(out.candidates).toBe(1);
    expect(out.matched).toBe(1);
    expect(out.downloaded).toBe(0);
    expect(out.failed).toBe(0);
    expect(TestCacheOne.requested).toEqual([]);
    expect(existsSync(cachePath(1, "0000000001-21-000001", "0000000001-21-000001.txt"))).toBe(false);
  });

  it("counts a fetch error as failed and continues", async () => {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put(candidate(1, "high"));
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).putBulk([
      filing({ cik: 1, accession_number: "acc-bad", form: "S-1" }),
      filing({ cik: 1, accession_number: "acc-ok", form: "S-1" }),
    ]);
    TestCacheOne.docs.set("1/acc-bad/acc-bad.txt", new Error("404"));
    TestCacheOne.docs.set("1/acc-ok/acc-ok.txt", "ok");

    const out = await runDownload({ set: "registration" });
    expect(out.downloaded).toBe(1);
    expect(out.failed).toBe(1);
  });
});
