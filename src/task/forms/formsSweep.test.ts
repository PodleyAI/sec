/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  globalServiceRegistry,
  IExecuteContext,
  OutputTask,
  Workflow,
  type DataPorts,
  type ITask,
} from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DRY_RUN } from "../../config/tokens";
import { registerFormExtractor } from "../../sec/forms/formExtractors";
import { PARSER_ONLY_FORMS_BY_EXTRACTOR } from "../../sec/forms/parserOnlyForms";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { ComputeFormsWorklistTask } from "./ComputeFormsWorklistTask";
import { formsSweepLoop, parseShardOption } from "./formsSweep";
import {
  ProcessAccessionDocFormTask,
  type ProcessAccessionDocFormTaskInput,
} from "./ProcessAccessionDocFormTask";

// This package parses the listing-removal family and does not read it — the
// `25-15` extractor is supplied by a consumer — so a Form 25 reaches no sweep
// here at all. Its PLACE in the sweep order still has to be right in a
// deployment that has that consumer, which is what `SWEEP_PRIORITY` keeps a
// slot for, so the order below is exercised against a stand-in registered over
// exactly the forms this package pins as parser-only.
registerFormExtractor({
  id: "25-15",
  forms: PARSER_ONLY_FORMS_BY_EXTRACTOR["25-15"],
  needsDocument: false,
  store: async () => {},
});

interface SeedFiling {
  cik: number;
  accession_number: string;
  form: string;
  primary_doc: string;
  items?: string | null;
  filing_date?: string;
}

async function seed(f: SeedFiling): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: f.cik,
    accession_number: f.accession_number,
    form: f.form,
    primary_doc: f.primary_doc,
    file_number: "333-1",
    filing_date: f.filing_date ?? "2026-01-02",
    acceptance_date: "2026-01-02T00:00:00.000Z",
    report_date: null,
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: f.items ?? null,
    act: null,
  } as never);
}

// Records the per-iteration inputs the sweep fans out, without doing any real
// fetch/parse work — isolates the graph wiring (producer arrays -> forEach zip
// -> inner task) from ProcessAccessionDocFormTask's heavy body.
const recorded: ProcessAccessionDocFormTaskInput[] = [];
class RecordingProcessTask extends ProcessAccessionDocFormTask {
  static readonly type = "RecordingProcessTask";
  override async execute(
    input: ProcessAccessionDocFormTaskInput,
    _context: IExecuteContext
  ): Promise<{ success: boolean }> {
    recorded.push({ ...input });
    return { success: true };
  }
}

describe("forms sweep wiring", () => {
  beforeEach(async () => {
    recorded.length = 0;
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("ComputeFormsWorklistTask emits index-aligned worklist arrays (xsl prefix stripped)", async () => {
    await seed({
      cik: 111,
      accession_number: "0000000001-26-000001",
      form: "3",
      primary_doc: "a.xml",
    });
    await seed({
      cik: 222,
      accession_number: "0000000002-26-000002",
      form: "3",
      primary_doc: "xslF345X02/b.xml",
    });

    const out = await new ComputeFormsWorklistTask({ defaults: { form: ["3"] } }).run({});

    expect(out.count).toBe(2);
    expect(out.accessionNumber).toEqual(["0000000001-26-000001", "0000000002-26-000002"]);
    expect(out.cik).toEqual([111, 222]);
    expect(out.form).toEqual(["3", "3"]);
    // The EDGAR inline-XBRL viewer prefix must be stripped from fileName.
    expect(out.fileName).toEqual(["a.xml", "b.xml"]);
  });

  it("drains forms in sweep order, not object-key order", async () => {
    // The worklist's default form list comes back in registration order, an
    // accident of import order rather than a dependency order, and it can put
    // the bare "25" long before the S-1 that mints the spac row the
    // listing-removal handler is gated on. A first-pass sweep therefore dropped
    // every deregistration as a successful no-op.
    await seed({
      cik: 111,
      accession_number: "0000000001-26-000001",
      form: "25",
      primary_doc: "a.htm",
    });
    await seed({
      cik: 222,
      accession_number: "0000000002-26-000002",
      form: "S-1",
      primary_doc: "b.htm",
    });

    const producer = new ComputeFormsWorklistTask({ defaults: {} });
    const out = await producer.run({});
    const emitted = out.form;

    expect(emitted).toContain("S-1");
    expect(emitted).toContain("25");
    expect(emitted.indexOf("S-1")).toBeLessThan(emitted.indexOf("25"));
  });

  it("filters the worklist to an allow-list of CIKs when ciks is non-empty", async () => {
    await seed({
      cik: 1,
      accession_number: "0000000001-26-000001",
      form: "D",
      primary_doc: "a.xml",
    });
    await seed({
      cik: 2,
      accession_number: "0000000002-26-000002",
      form: "D",
      primary_doc: "b.xml",
    });

    const producer = new ComputeFormsWorklistTask({
      defaults: { form: ["D"], ciks: [1] },
    });
    const out = await producer.run({});
    const emittedCiks = out.cik;

    expect(emittedCiks).toEqual([1]);
  });

  it("does not read filings for CIKs outside the allow-list", async () => {
    // `sync spacs` passes the known-SPAC CIK set, but the worklist used to
    // page every filing of each SPAC form (every 424B2 in EDGAR) and only
    // then drop other CIKs. Bank of America's 10k+ 424B2s are not SPACs and
    // must never be loaded.
    await seed({
      cik: 1,
      accession_number: "0000000001-26-000001",
      form: "D",
      primary_doc: "a.xml",
    });
    await seed({
      cik: 9631,
      accession_number: "0000009631-26-000001",
      form: "D",
      primary_doc: "b.xml",
    });

    const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const criteria: unknown[] = [];
    const realQuery = repo.query.bind(repo);
    repo.query = ((c: unknown, options: unknown) => {
      criteria.push(c);
      return realQuery(c as never, options as never);
    }) as typeof repo.query;

    try {
      const producer = new ComputeFormsWorklistTask({
        defaults: { form: ["D"], ciks: [1] },
      });
      const out = await producer.run({});
      const emittedCiks = out.cik;
      expect(emittedCiks).toEqual([1]);
    } finally {
      repo.query = realQuery;
    }

    expect(criteria.length).toBeGreaterThan(0);
    for (const c of criteria) {
      expect(c).toMatchObject({ form: "D" });
      const cik = (c as { cik?: unknown }).cik;
      expect(cik).toBeDefined();
      if (typeof cik === "number") {
        expect(cik).toBe(1);
        continue;
      }
      const cond = cik as { value?: unknown; operator?: string };
      if (cond.operator === "in") {
        const values = Array.isArray(cond.value) ? cond.value : [cond.value];
        expect(values).toEqual([1]);
        continue;
      }
      if (cond.operator === "=") {
        expect(cond.value).toBe(1);
        continue;
      }
      throw new Error(`unbounded cik constraint: ${JSON.stringify(cik)}`);
    }
  });

  it("when filedOnOrAfter is set, emits only filings on or after that date", async () => {
    await seed({
      cik: 1,
      accession_number: "0000000001-26-000001",
      form: "8-K",
      primary_doc: "old.htm",
      items: "5.07",
      filing_date: "2026-01-02",
    });
    await seed({
      cik: 1,
      accession_number: "0000000001-26-000002",
      form: "8-K",
      primary_doc: "new.htm",
      items: "5.07",
      filing_date: "2026-08-20",
    });

    const producer = new ComputeFormsWorklistTask({
      defaults: { form: ["8-K"], filedOnOrAfter: "2026-08-19" },
    });
    const out = await producer.run({});
    const emitted = out.accessionNumber;

    expect(emitted).toEqual(["0000000001-26-000002"]);
  });

  it("includes all CIKs when ciks is omitted", async () => {
    await seed({
      cik: 1,
      accession_number: "0000000001-26-000001",
      form: "D",
      primary_doc: "a.xml",
    });
    await seed({
      cik: 2,
      accession_number: "0000000002-26-000002",
      form: "D",
      primary_doc: "b.xml",
    });

    const producer = new ComputeFormsWorklistTask({
      defaults: { form: ["D"] },
    });
    const out = await producer.run({});
    const emittedCiks = out.cik;

    expect(emittedCiks.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("shards the worklist disjointly and completely across shardCount", async () => {
    const accessions: string[] = [];
    for (let i = 1; i <= 40; i++) {
      const acc = `0000000${String(i).padStart(3, "0")}-26-000001`;
      accessions.push(acc);
      await seed({ cik: 100 + i, accession_number: acc, form: "3", primary_doc: "a.xml" });
    }

    const N = 3;
    const perShard: string[][] = [];
    for (let s = 0; s < N; s++) {
      const out = await new ComputeFormsWorklistTask({
        defaults: { form: ["3"], shardIndex: s, shardCount: N },
      }).run({});
      perShard.push(out.accessionNumber);
      expect(out.count).toBe(out.accessionNumber.length);
    }

    // Complete: union of shards == every filing.
    const union = new Set(perShard.flat());
    expect(union.size).toBe(accessions.length);
    for (const a of accessions) expect(union.has(a)).toBe(true);
    // Disjoint: total across shards has no duplicates.
    expect(perShard.flat().length).toBe(accessions.length);
    // Deterministic: the same shard yields the same set on a second run.
    const rerun = await new ComputeFormsWorklistTask({
      defaults: { form: ["3"], shardIndex: 0, shardCount: N },
    }).run({});
    expect(new Set(rerun.accessionNumber)).toEqual(new Set(perShard[0]));
  });

  it("reads each form in bounded pages instead of materializing the whole form", async () => {
    // Regression guard for the worklist OOM: the producer used to call
    // `filingRepo.query({ form })`, pulling every filing of a form into one
    // array (~4.6M rows for form 4, ~3 GB per process — and every `--shard`
    // process paid it in full, because the shard filter ran afterwards).
    // Every read must stay bounded no matter how large the form is.
    await seed({
      cik: 111,
      accession_number: "0000000001-26-000001",
      form: "3",
      primary_doc: "a.xml",
    });
    await seed({
      cik: 222,
      accession_number: "0000000002-26-000002",
      form: "3",
      primary_doc: "b.xml",
    });

    const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const limits: Array<number | undefined> = [];
    const realQuery = repo.query.bind(repo);
    repo.query = ((criteria: never, options: { limit?: number } | undefined) => {
      limits.push(options?.limit);
      return realQuery(criteria, options as never);
    }) as typeof repo.query;

    try {
      const out = await new ComputeFormsWorklistTask({ defaults: { form: ["3"] } }).run({});
      expect(out.count).toBe(2);

      expect(limits.length).toBeGreaterThan(0);
      // A bare `query({ form })` — the regressed call — has no options at all,
      // so an undefined limit is exactly the failure this guards against.
      for (const limit of limits) {
        expect(limit).toBeTypeOf("number");
        expect(limit!).toBeGreaterThan(0);
        expect(limit!).toBeLessThanOrEqual(10_000);
      }
    } finally {
      repo.query = realQuery;
    }
  });

  it("advances past a (form, cik) group larger than the filing page", async () => {
    // Resume used to re-read `cik >= lastCik` and drop the already-emitted head
    // in memory, which requires the page to be larger than every (form, cik)
    // group. CIK 9631 has >10k 424B2s, so a full page is consumed by that head
    // and the scan throws rather than walking the rest of the form.
    // `--dry-run` examines every row of each page, so the second page is the
    // one that used to stall.
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const groupSize = 10_001;
    const rows = [];
    for (let i = 1; i <= groupSize; i++) {
      rows.push({
        cik: 111,
        accession_number: `0000000111-26-${String(i).padStart(6, "0")}`,
        form: "3",
        primary_doc: "a.xml",
        file_number: "333-1",
        filing_date: "2026-01-02",
        acceptance_date: "2026-01-02T00:00:00.000Z",
        report_date: null,
        film_number: null,
        primary_doc_description: null,
        size: null,
        is_xbrl: null,
        is_inline_xbrl: null,
        items: null,
        act: null,
      });
    }
    rows.push({
      cik: 222,
      accession_number: "0000000222-26-000001",
      form: "3",
      primary_doc: "b.xml",
      file_number: "333-1",
      filing_date: "2026-01-02",
      acceptance_date: "2026-01-02T00:00:00.000Z",
      report_date: null,
      film_number: null,
      primary_doc_description: null,
      size: null,
      is_xbrl: null,
      is_inline_xbrl: null,
      items: null,
      act: null,
    });
    await repo.putBulk(rows as never);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };
    try {
      await expect(
        new ComputeFormsWorklistTask({ defaults: { form: ["3"] } }).run({})
      ).resolves.toMatchObject({ count: 0 });
    } finally {
      console.log = originalLog;
    }

    expect(logs.some((line) => line.includes(`Would process ${groupSize + 1}`))).toBe(true);
  });

  it("emits the full worklist in one run, covering every filing once", async () => {
    // The producer used to yield 5k-item batches for a while-loop fan-out.
    // The worklist size is known after the scan, so one run returns every
    // filing and the downstream forEach maps i/N.
    const accessions: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const acc = `0000000${String(i).padStart(3, "0")}-26-000001`;
      accessions.push(acc);
      await seed({ cik: 100 + i, accession_number: acc, form: "3", primary_doc: "a.xml" });
    }

    const out = await new ComputeFormsWorklistTask({ defaults: { form: ["3"] } }).run({});
    expect(out.count).toBe(accessions.length);
    expect(out.accessionNumber.length).toBe(accessions.length);
    expect(new Set(out.accessionNumber)).toEqual(new Set(accessions));
  });

  it("parseShardOption converts 1-based i/N to a 0-based shard and rejects bad input", () => {
    expect(parseShardOption(undefined)).toBeUndefined();
    expect(parseShardOption("")).toBeUndefined();
    expect(parseShardOption("1/6")).toEqual({ index: 0, count: 6 });
    expect(parseShardOption("6/6")).toEqual({ index: 5, count: 6 });
    expect(() => parseShardOption("0/6")).toThrow(); // 1-based, 0 invalid
    expect(() => parseShardOption("7/6")).toThrow(); // out of range
    expect(() => parseShardOption("abc")).toThrow();
  });

  it("forEach loop fans one iteration per filing with correctly zipped inputs", async () => {
    await seed({
      cik: 111,
      accession_number: "0000000001-26-000001",
      form: "3",
      primary_doc: "a.xml",
    });
    await seed({
      cik: 222,
      accession_number: "0000000002-26-000002",
      form: "3",
      primary_doc: "b.xml",
    });
    await seed({
      cik: 333,
      accession_number: "0000000003-26-000003",
      form: "3",
      primary_doc: "c.xml",
    });

    // Mirror addFormsSweepLoop's structure, but with the recording inner task so
    // we can observe what each iteration receives.
    const wf = new Workflow();
    wf.pipe(
      new ComputeFormsWorklistTask({ defaults: { form: ["3"] } }) as ITask<DataPorts, DataPorts>
    );
    const loop = wf.forEach({ concurrencyLimit: 20 });
    loop.pipe(new RecordingProcessTask() as ITask<DataPorts, DataPorts>);
    loop.endForEach();
    wf.pipe(new OutputTask() as ITask<DataPorts, DataPorts>);
    await wf.run({});

    expect(recorded).toHaveLength(3);
    // Order-independent: each seeded filing must appear exactly once with its
    // own cik/form/fileName zipped alongside its accession number.
    const byAccession = new Map(recorded.map((r) => [r.accessionNumber, r]));
    expect(byAccession.get("0000000001-26-000001")).toMatchObject({
      cik: 111,
      form: "3",
      fileName: "a.xml",
    });
    expect(byAccession.get("0000000002-26-000002")).toMatchObject({
      cik: 222,
      form: "3",
      fileName: "b.xml",
    });
    expect(byAccession.get("0000000003-26-000003")).toMatchObject({
      cik: 333,
      form: "3",
      fileName: "c.xml",
    });
  });

  it("surfaces the inner task's updateProgress message on the iterator's iteration_progress", async () => {
    // End-to-end propagation: an inner task's context.updateProgress(p, msg)
    // must reach the ForEach node's iteration_progress event (that is what the
    // CLI renders on each worker row). Without it every iteration row is a bare
    // spinner.
    await seed({
      cik: 111,
      accession_number: "0000000001-26-000001",
      form: "3",
      primary_doc: "a.xml",
    });

    class ProgressTask extends ProcessAccessionDocFormTask {
      static readonly type = "ProgressTask";
      override async execute(
        input: ProcessAccessionDocFormTaskInput,
        context: IExecuteContext
      ): Promise<{ success: boolean }> {
        await context.updateProgress(50, `${input.form} ${input.accessionNumber} · working`);
        return { success: true };
      }
    }

    const wf = new Workflow();
    wf.pipe(
      new ComputeFormsWorklistTask({ defaults: { form: ["3"] } }) as ITask<DataPorts, DataPorts>
    );
    const loop = wf.forEach({ concurrencyLimit: 20 });
    loop.pipe(new ProgressTask() as ITask<DataPorts, DataPorts>);
    loop.endForEach();
    wf.pipe(new OutputTask() as ITask<DataPorts, DataPorts>);

    const messages: Array<string | undefined> = [];
    const iterator = wf.graph
      .getTasks()
      .find((t) => (t as { type?: string }).type === "ForEachTask");
    expect(iterator).toBeDefined();
    iterator!.events.on("iteration_progress", (_i, _n, _p, message) => {
      messages.push(message);
    });

    await wf.run({});

    expect(messages).toContain("3 0000000001-26-000001 · working");
  });

  it("formsSweepLoop is compute-then-forEach, not a while over batches", () => {
    // The worklist size is known after one producer run, so the outer graph is
    // ComputeFormsWorklistTask → ForEachTask. A WhileTask over 5k-item maps
    // showed "Iteration 8/Infinity: Map 408/5000" on a sweep whose N was known.
    const wf = new Workflow();
    formsSweepLoop(new ComputeFormsWorklistTask({ defaults: { form: ["3"] } }))(wf);
    const types = wf.graph.getTasks().map((t) => (t as { type?: string }).type);
    expect(types).not.toContain("WhileTask");
    expect(types).toContain("ComputeFormsWorklistTask");
    expect(types).toContain("ForEachTask");
  });

  it("formsSweepLoop builds a runnable forEach sweep over the computed worklist", async () => {
    // Exercises the exact production helper (not a hand-rolled copy) end to end.
    // ProcessAccessionDocFormTask has no primary_doc match here, so it
    // dead-letters PRIMARY_DOC_UNRESOLVED and returns {success:false} per
    // filing — the point is that the loop runs one iteration per filing without
    // throwing, proving formsSweepLoop wires the outer graph correctly.
    await seed({ cik: 111, accession_number: "0000000001-26-000001", form: "3", primary_doc: "" });
    await seed({ cik: 222, accession_number: "0000000002-26-000002", form: "3", primary_doc: "" });

    const wf = new Workflow();
    formsSweepLoop(new ComputeFormsWorklistTask({ defaults: { form: ["3"] } }))(wf);
    wf.pipe(new OutputTask() as ITask<DataPorts, DataPorts>);

    await expect(wf.run({})).resolves.toBeDefined();
  });

  it("survives a filing whose storage handler throws, dead-lettering it instead", async () => {
    // The fan-out has no per-iteration guard, so a rethrown store failure used
    // to reject the whole outer workflow and abandon every remaining filing.
    // The bad filing must now be recorded as a STORE_ERROR and skipped while
    // its siblings still store.
    const acc = (n: number) => `000000000${n}-26-00000${n}`;
    await seed({ cik: 111, accession_number: acc(1), form: "D", primary_doc: "a.xml" });
    await seed({ cik: 222, accession_number: acc(2), form: "D", primary_doc: "b.xml" });
    await seed({ cik: 333, accession_number: acc(3), form: "D", primary_doc: "c.xml" });

    const goodFormD = readFileSync(
      path.join(
        __dirname,
        "../../sec/forms/exempt-offerings/mock_data/form-d/000192959422000001-primary_doc.xml"
      ),
      "utf-8"
    );

    // formsSweepLoop constructs the production task itself, so the fetch seam is
    // stubbed on the prototype rather than by subclassing — the graph under test
    // stays the real one.
    const proto = ProcessAccessionDocFormTask.prototype as unknown as {
      runFetch: (cik: number, accessionNumber: string) => Promise<string>;
    };
    const realRunFetch = proto.runFetch;
    proto.runFetch = async (_cik: number, accessionNumber: string) =>
      accessionNumber === acc(2) ? "<edgarSubmission><unclosed>" : goodFormD;

    try {
      const wf = new Workflow();
      formsSweepLoop(new ComputeFormsWorklistTask({ defaults: { form: ["D"] } }))(wf);
      wf.pipe(new OutputTask() as ITask<DataPorts, DataPorts>);

      await expect(wf.run({})).resolves.toBeDefined();
    } finally {
      proto.runFetch = realRunFetch;
    }

    const deadLetters = new ExtractionDeadLetterRepo();
    expect((await deadLetters.get("D", acc(2), ""))?.reason_code).toBe("STORE_ERROR");

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    expect((await runRepo.findRun(111, acc(1), "D", "1.0.0"))?.success).toBe(true);
    expect((await runRepo.findRun(222, acc(2), "D", "1.0.0"))?.success).toBe(false);
    // The filing after the failure is the one a rethrow used to lose.
    expect((await runRepo.findRun(333, acc(3), "D", "1.0.0"))?.success).toBe(true);
  });
});
