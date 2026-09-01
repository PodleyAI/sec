/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  globalServiceRegistry,
  Task,
  type DataPortSchema,
  type IExecuteContext,
  type ITask,
  type StreamEvent,
} from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../../storage/filing/FilingSchema";
import type { TaskPorts } from "../taskPorts";
import {
  BootstrapAccessionDocsTask,
  type BootstrapAccessionDocsTaskInput,
} from "./BootstrapAccessionDocsTask";

// --- Minimal tar.gz builder (shared shape with feedTarball.test.ts) ---------

function tarHeader(name: string, size: number): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, "ascii");
  h.write("0000644\0", 100, "ascii");
  h.write("0000000\0", 108, "ascii");
  h.write("0000000\0", 116, "ascii");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  h.write("00000000000\0", 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write("0", 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

function makeTarGz(entries: ReadonlyArray<{ name: string; body: string }>): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.from(e.body, "utf-8");
    parts.push(tarHeader(e.name, body.length));
    parts.push(body);
    const pad = (512 - (body.length % 512)) % 512;
    if (pad > 0) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

// --- A test producer whose Feed source is a canned per-date tarball ---------

type FeedFixture = Buffer | "missing" | Error;

/**
 * Stands in for `SecFetchTask` with `response_type: "stream"`: same `body`
 * port, same binary deltas. Everything downstream — the graph edge, the
 * passthrough, the sink, the tar walk, the cache writes — is production code.
 */
class CannedFeedFetchTask extends Task<TaskPorts<{ url?: string }>, TaskPorts<{ body?: unknown }>> {
  static readonly type = "CannedFeedFetchTask";
  static readonly category = "SEC";
  static readonly title = "Canned feed download";
  static readonly cacheable = false;

  public fixture: FeedFixture = "missing";
  /** Chunk size, so a test can prove the sink is fed incrementally. */
  public chunkSize = 64 * 1024;

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
      properties: { body: { title: "Body", "x-stream": "binary", format: "blob" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(): AsyncIterable<StreamEvent<{ body?: unknown }>> {
    const fx = this.fixture;
    if (fx === "missing") {
      // The shape a 404 arrives in — SecFetchJob throws before any byte.
      throw Object.assign(new Error("Fetch failed: 404 Not Found"), { status: 404 });
    }
    if (fx instanceof Error) throw fx;
    for (let at = 0; at < fx.length; at += this.chunkSize) {
      yield {
        type: "binary-delta",
        port: "body",
        binaryDelta: new Uint8Array(fx.subarray(at, at + this.chunkSize)),
      };
    }
    yield { type: "finish", data: {} };
  }

  async execute(): Promise<{ body?: unknown }> {
    throw new Error("CannedFeedFetchTask only streams");
  }
}

class TestBootstrapAccessionDocsTask extends BootstrapAccessionDocsTask {
  public readonly requested: string[] = [];
  constructor(
    private readonly fixtures: Map<string, FeedFixture>,
    opts?: { defaults?: BootstrapAccessionDocsTaskInput }
  ) {
    super(opts);
  }
  protected override createFeedFetchTask(date: string): ITask {
    this.requested.push(date);
    const task = new CannedFeedFetchTask({ title: `Download ${date}` });
    task.fixture = this.fixtures.get(date) ?? "missing";
    return task as unknown as ITask;
  }
}

function ctx(controller: AbortController = new AbortController()): IExecuteContext {
  return {
    signal: controller.signal,
    updateProgress: () => {},
    own: <T>(value: T) => value,
    disown: () => {},
  } as unknown as IExecuteContext;
}

function filing(partial: Partial<Filing> & Pick<Filing, "cik" | "accession_number">): Filing {
  return {
    report_date: null,
    acceptance_date: "2021-03-05T12:00:00.000Z",
    form: null,
    file_number: null,
    film_number: null,
    primary_doc: "",
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

let raw: string;

beforeEach(async () => {
  resetDependencyInjectionsForTesting();
  raw = mkdtempSync(path.join(tmpdir(), "sec-feeddocs-test-"));
  globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, raw);
});

afterEach(() => {
  rmSync(raw, { recursive: true, force: true });
  resetDependencyInjectionsForTesting();
});

async function seedFilings(rows: Filing[]): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).putBulk(rows);
}

describe("BootstrapAccessionDocsTask", () => {
  it("writes the primary document for a non-registration form", async () => {
    const acc = "0001193125-21-066104";
    await seedFilings([
      filing({ cik: 1193125, accession_number: acc, form: "4", primary_doc: "wf-form4.xml" }),
    ]);
    const submission = [
      "<SEC-HEADER>",
      "</SEC-HEADER>",
      "<DOCUMENT>",
      "<TYPE>4",
      "<FILENAME>wf-form4.xml",
      "<TEXT>",
      "<ownershipDocument/>",
      "</TEXT>",
      "</DOCUMENT>",
    ].join("\n");
    const gz = makeTarGz([{ name: `20210305.nc/${acc}.nc`, body: submission }]);

    const task = new TestBootstrapAccessionDocsTask(new Map([["2021-03-05", gz]]));
    const out = await task.execute({}, ctx());

    expect(out.success).toBe(true);
    expect(out.daysProcessed).toBe(1);
    expect(out.docsWritten).toBe(1);
    const primaryPath = path.join(
      raw,
      "accessiondocs",
      "0001193125",
      "000119312521066104-wf-form4.xml"
    );
    expect(readFileSync(primaryPath, "utf-8")).toBe("<ownershipDocument/>");
    // A non-registration, non-8-K form gets no full-submission `.txt`.
    expect(
      existsSync(path.join(raw, "accessiondocs", "0001193125", `000119312521066104-${acc}.txt`))
    ).toBe(false);
    // The day is marked done.
    expect(existsSync(path.join(raw, "accessiondocs", ".feed-done", "20210305"))).toBe(true);
  });

  it("writes the full submission `.txt` when a filing has no primary document (pre-2003 filings)", async () => {
    const acc = "0000912057-00-000076";
    await seedFilings([
      // Old filing: non-registration form, empty primary_doc.
      filing({
        cik: 1102174,
        accession_number: acc,
        form: "SC 13D",
        primary_doc: "",
        filing_date: "2000-01-03",
      }),
    ]);
    const submission =
      "<SUBMISSION>\n<ACCESSION-NUMBER>0000912057-00-000076\n<TYPE>SC 13D\n<DOCUMENT>\n<TYPE>SC 13D\n<TEXT>\nSCHEDULE 13D text\n</TEXT>\n</DOCUMENT>\n</SUBMISSION>";
    const gz = makeTarGz([{ name: `${acc}.nc`, body: submission }]);

    const task = new TestBootstrapAccessionDocsTask(new Map([["2000-01-03", gz]]));
    const out = await task.execute({}, ctx());

    expect(out.docsWritten).toBe(1);
    const fullSubPath = path.join(
      raw,
      "accessiondocs",
      "0001102174",
      `000091205700000076-${acc}.txt`
    );
    expect(readFileSync(fullSubPath, "utf-8")).toBe(submission);
  });

  it("falls back to the full submission when a primary doc exists but can't be sliced", async () => {
    const acc = "0000085399-00-000030";
    await seedFilings([
      // primary_doc records a mangled name that no <FILENAME> in the .nc matches.
      filing({
        cik: 85399,
        accession_number: acc,
        form: "10-K",
        primary_doc: "0000085399-00-000030-d1.html",
        filing_date: "2000-06-15",
      }),
    ]);
    const submission =
      "<SUBMISSION>\n<DOCUMENT>\n<TYPE>10-K\n<FILENAME>d1.html\n<TEXT>\n<html>real body</html>\n</TEXT>\n</DOCUMENT>\n</SUBMISSION>";
    const gz = makeTarGz([{ name: `${acc}.nc`, body: submission }]);

    const task = new TestBootstrapAccessionDocsTask(new Map([["2000-06-15", gz]]));
    const out = await task.execute({}, ctx());

    // The mangled primary name isn't sliced; the full submission is stored instead.
    expect(out.docsWritten).toBe(1);
    expect(
      existsSync(
        path.join(
          raw,
          "accessiondocs",
          "0000085399",
          "000008539900000030-0000085399-00-000030-d1.html"
        )
      )
    ).toBe(false);
    const fullSubPath = path.join(
      raw,
      "accessiondocs",
      "0000085399",
      `000008539900000030-${acc}.txt`
    );
    expect(readFileSync(fullSubPath, "utf-8")).toBe(submission);
  });

  it("writes the full submission `.txt` for a registration prospectus form", async () => {
    const acc = "0001193125-21-066105";
    await seedFilings([
      filing({ cik: 1193125, accession_number: acc, form: "S-1", primary_doc: "d123.htm" }),
    ]);
    const submission =
      "<SEC-HEADER>\n</SEC-HEADER>\n<DOCUMENT>\n<TYPE>S-1\n<FILENAME>d123.htm\n<TEXT>\n<html/>\n</TEXT>\n</DOCUMENT>";
    const gz = makeTarGz([{ name: `${acc}.nc`, body: submission }]);

    const task = new TestBootstrapAccessionDocsTask(new Map([["2021-03-05", gz]]));
    const out = await task.execute({}, ctx());

    expect(out.docsWritten).toBe(1);
    const fullSubPath = path.join(
      raw,
      "accessiondocs",
      "0001193125",
      `000119312521066105-${acc}.txt`
    );
    expect(readFileSync(fullSubPath, "utf-8")).toBe(submission);
    // Registration forms read the full submission, not the sliced primary doc.
    expect(
      existsSync(path.join(raw, "accessiondocs", "0001193125", "000119312521066105-d123.htm"))
    ).toBe(false);
  });

  it("caches the doc under every co-filer cik that shares one accession", async () => {
    const acc = "0000912057-00-000076";
    await seedFilings([
      filing({ cik: 1102174, accession_number: acc, form: "SC 13D", primary_doc: "" }),
      filing({ cik: 1097588, accession_number: acc, form: "SC 13D", primary_doc: "" }),
    ]);
    const submission =
      "<SUBMISSION>\n<DOCUMENT>\n<TYPE>SC 13D\n<TEXT>\n13D\n</TEXT>\n</DOCUMENT>\n</SUBMISSION>";
    const gz = makeTarGz([{ name: `${acc}.nc`, body: submission }]);

    const task = new TestBootstrapAccessionDocsTask(new Map([["2021-03-05", gz]]));
    const out = await task.execute({}, ctx());

    expect(out.docsWritten).toBe(2);
    for (const cik10 of ["0001102174", "0001097588"]) {
      const p = path.join(raw, "accessiondocs", cik10, `000091205700000076-${acc}.txt`);
      expect(readFileSync(p, "utf-8")).toBe(submission);
    }
  });

  it("does not mark a day done when its Feed tarball is missing (404)", async () => {
    const acc = "0001193125-21-066106";
    await seedFilings([
      filing({
        cik: 1193125,
        accession_number: acc,
        form: "4",
        primary_doc: "f.xml",
        filing_date: "2026-07-24",
      }),
    ]);
    const task = new TestBootstrapAccessionDocsTask(new Map([["2026-07-24", "missing"]]));
    const out = await task.execute({}, ctx());

    expect(out.daysProcessed).toBe(0);
    expect(out.failed).toBe(0);
    expect(existsSync(path.join(raw, "accessiondocs", ".feed-done", "20260724"))).toBe(false);
  });

  it("counts a failed day, leaves it unmarked, and finishes the rest of the sweep", async () => {
    // A range can be thousands of days, and the ones already extracted are
    // worth keeping — so one 403, 429 or truncated archive is tallied rather
    // than aborting. The marker is not written, so a re-run retries it.
    const bad = "0001193125-21-000001";
    const good = "0001193125-21-000002";
    await seedFilings([
      filing({ cik: 1, accession_number: bad, form: "8-K", filing_date: "2021-03-05" }),
      filing({ cik: 2, accession_number: good, form: "8-K", filing_date: "2021-03-08" }),
    ]);
    const gz = makeTarGz([{ name: `${good}.nc`, body: "<SUBMISSION>ok</SUBMISSION>" }]);

    const task = new TestBootstrapAccessionDocsTask(
      new Map<string, FeedFixture>([
        ["2021-03-05", new Error("HTTP 403 Forbidden")],
        ["2021-03-08", gz],
      ])
    );
    const out = await task.execute({}, ctx());

    expect(out.failed).toBe(1);
    expect(out.daysProcessed).toBe(1);
    expect(out.docsWritten).toBe(1);
    expect(existsSync(path.join(raw, "accessiondocs", ".feed-done", "20210305"))).toBe(false);
    expect(existsSync(path.join(raw, "accessiondocs", ".feed-done", "20210308"))).toBe(true);
  });

  it("skips days already marked done unless --force", async () => {
    const acc = "0001193125-21-066107";
    await seedFilings([
      filing({ cik: 1193125, accession_number: acc, form: "4", primary_doc: "f.xml" }),
    ]);
    const submission = "<DOCUMENT>\n<FILENAME>f.xml\n<TEXT>\n<x/>\n</TEXT>\n</DOCUMENT>";
    const gz = makeTarGz([{ name: `${acc}.nc`, body: submission }]);

    const first = new TestBootstrapAccessionDocsTask(new Map([["2021-03-05", gz]]));
    await first.execute({}, ctx());
    expect(first.requested).toEqual(["2021-03-05"]);

    // Second run: the day is marked done, so the Feed is not requested again.
    const second = new TestBootstrapAccessionDocsTask(new Map([["2021-03-05", gz]]));
    const out2 = await second.execute({}, ctx());
    expect(second.requested).toEqual([]);
    expect(out2.daysProcessed).toBe(0);

    // With force, the day is re-downloaded.
    const third = new TestBootstrapAccessionDocsTask(new Map([["2021-03-05", gz]]));
    await third.execute({ force: true }, ctx());
    expect(third.requested).toEqual(["2021-03-05"]);
  });

  it("refuses a filer-controlled primary_doc that tries to escape the cik directory", async () => {
    const acc = "0001193125-21-066108";
    const attackerRel = "../../../../../etc/edgar-attacker";
    await seedFilings([
      filing({
        cik: 1193125,
        accession_number: acc,
        form: "4",
        primary_doc: attackerRel,
      }),
    ]);
    // The `<FILENAME>` in the .nc matches the raw filer value, so the
    // extractor would happily slice a body — the sanitizer is what stops us
    // from writing it to a traversed path.
    const submission = [
      "<DOCUMENT>",
      "<TYPE>4",
      `<FILENAME>${attackerRel}`,
      "<TEXT>",
      "pwned",
      "</TEXT>",
      "</DOCUMENT>",
    ].join("\n");
    const gz = makeTarGz([{ name: `${acc}.nc`, body: submission }]);

    const origWarn = console.warn;
    const warned: string[] = [];
    console.warn = (...args: unknown[]) => {
      warned.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    };
    let out;
    try {
      const task = new TestBootstrapAccessionDocsTask(new Map([["2021-03-05", gz]]));
      out = await task.execute({}, ctx());
    } finally {
      console.warn = origWarn;
    }

    // The unsafe primary doc is skipped; only the full-submission `.txt`
    // fallback under the cik directory is allowed to write.
    expect(out.docsWritten).toBe(1);
    const fullSubPath = path.join(
      raw,
      "accessiondocs",
      "0001193125",
      `000119312521066108-${acc}.txt`
    );
    expect(readFileSync(fullSubPath, "utf-8")).toBe(submission);

    // Nothing escaped the cik directory to the raw root's parent…
    expect(existsSync(path.join(path.dirname(raw), "edgar-attacker"))).toBe(false);
    // …nor to `/etc/edgar-attacker` (test only asserts absence; system dirs stay clean).
    expect(existsSync("/etc/edgar-attacker")).toBe(false);

    // A warning identifies the filing and the offending value.
    const warnedJoined = warned.join("\n");
    expect(warnedJoined).toContain("1193125");
    expect(warnedJoined).toContain(acc);
    expect(warnedJoined).toContain(JSON.stringify(attackerRel));
  });

  it("honours the [from, to] date range", async () => {
    await seedFilings([
      filing({
        cik: 1,
        accession_number: "0000000001-21-000001",
        form: "4",
        primary_doc: "a.xml",
        filing_date: "2021-03-01",
      }),
      filing({
        cik: 2,
        accession_number: "0000000002-21-000002",
        form: "4",
        primary_doc: "b.xml",
        filing_date: "2021-03-05",
      }),
      filing({
        cik: 3,
        accession_number: "0000000003-21-000003",
        form: "4",
        primary_doc: "c.xml",
        filing_date: "2021-03-10",
      }),
    ]);
    const gz = makeTarGz([{ name: "x.nc", body: "<DOCUMENT/>" }]);
    const task = new TestBootstrapAccessionDocsTask(
      new Map([
        ["2021-03-01", gz],
        ["2021-03-05", gz],
        ["2021-03-10", gz],
      ])
    );
    await task.execute({ from: "2021-03-04", to: "2021-03-06" }, ctx());
    expect(task.requested).toEqual(["2021-03-05"]);
  });
});
