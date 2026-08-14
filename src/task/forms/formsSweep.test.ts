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
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
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

interface SeedFiling {
  cik: number;
  accession_number: string;
  form: string;
  primary_doc: string;
}

async function seed(f: SeedFiling): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: f.cik,
    accession_number: f.accession_number,
    form: f.form,
    primary_doc: f.primary_doc,
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
    await seed({ cik: 111, accession_number: "0000000001-26-000001", form: "3", primary_doc: "a.xml" });
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
    // JS orders integer-like keys first, so `Object.keys(FORM_TO_EXTRACTOR_ID)`
    // puts the bare "25" fourth — long before the S-1 that mints the spac row
    // `processDeregistration` is gated on. A first-pass sweep therefore dropped
    // every deregistration as a successful no-op.
    await seed({ cik: 111, accession_number: "0000000001-26-000001", form: "25", primary_doc: "a.htm" });
    await seed({ cik: 222, accession_number: "0000000002-26-000002", form: "S-1", primary_doc: "b.htm" });

    const producer = new ComputeFormsWorklistTask({ defaults: {} });
    const emitted: string[] = [];
    while (!producer.exhausted) {
      const out = await producer.run({});
      emitted.push(...out.form);
    }

    expect(emitted).toContain("S-1");
    expect(emitted).toContain("25");
    expect(emitted.indexOf("S-1")).toBeLessThan(emitted.indexOf("25"));
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
    await seed({ cik: 111, accession_number: "0000000001-26-000001", form: "3", primary_doc: "a.xml" });
    await seed({ cik: 222, accession_number: "0000000002-26-000002", form: "3", primary_doc: "b.xml" });

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

  it("emits bounded batches and resumes across them, covering every filing once", async () => {
    // The batch ceiling is what keeps the producer's memory independent of the
    // corpus: it must hand out at most `batchSize` per call and pick up exactly
    // where it left off, with no filing dropped or repeated across batches.
    const accessions: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const acc = `0000000${String(i).padStart(3, "0")}-26-000001`;
      accessions.push(acc);
      await seed({ cik: 100 + i, accession_number: acc, form: "3", primary_doc: "a.xml" });
    }

    const producer = new ComputeFormsWorklistTask({ defaults: { form: ["3"], batchSize: 3 } });
    const batches: string[][] = [];
    while (!producer.exhausted) {
      const out = await producer.run({});
      batches.push(out.accessionNumber);
      expect(out.accessionNumber.length).toBeLessThanOrEqual(3);
      expect(out.count).toBe(out.accessionNumber.length);
      expect(batches.length).toBeLessThanOrEqual(10); // guard against a non-advancing loop
    }

    expect(batches.length).toBeGreaterThan(1); // actually batched, not one big list
    const emitted = batches.flat();
    expect(emitted.length).toBe(accessions.length); // no duplicates across batches
    expect(new Set(emitted)).toEqual(new Set(accessions)); // and none dropped
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
    await seed({ cik: 111, accession_number: "0000000001-26-000001", form: "3", primary_doc: "a.xml" });
    await seed({ cik: 222, accession_number: "0000000002-26-000002", form: "3", primary_doc: "b.xml" });
    await seed({ cik: 333, accession_number: "0000000003-26-000003", form: "3", primary_doc: "c.xml" });

    // Mirror addFormsSweepLoop's structure, but with the recording inner task so
    // we can observe what each iteration receives.
    const wf = new Workflow();
    wf.pipe(new ComputeFormsWorklistTask({ defaults: { form: ["3"] } }) as ITask<DataPorts, DataPorts>);
    const loop = wf.forEach({ concurrencyLimit: 20 });
    loop.pipe(new RecordingProcessTask() as ITask<DataPorts, DataPorts>);
    loop.endForEach();
    wf.pipe(new OutputTask() as ITask<DataPorts, DataPorts>);
    await wf.run({});

    expect(recorded).toHaveLength(3);
    // Order-independent: each seeded filing must appear exactly once with its
    // own cik/form/fileName zipped alongside its accession number.
    const byAccession = new Map(recorded.map((r) => [r.accessionNumber, r]));
    expect(byAccession.get("0000000001-26-000001")).toMatchObject({ cik: 111, form: "3", fileName: "a.xml" });
    expect(byAccession.get("0000000002-26-000002")).toMatchObject({ cik: 222, form: "3", fileName: "b.xml" });
    expect(byAccession.get("0000000003-26-000003")).toMatchObject({ cik: 333, form: "3", fileName: "c.xml" });
  });

  it("surfaces the inner task's updateProgress message on the iterator's iteration_progress", async () => {
    // End-to-end propagation: an inner task's context.updateProgress(p, msg)
    // must reach the ForEach node's iteration_progress event (that is what the
    // CLI renders on each worker row). Without it every iteration row is a bare
    // spinner.
    await seed({ cik: 111, accession_number: "0000000001-26-000001", form: "3", primary_doc: "a.xml" });

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
    wf.pipe(new ComputeFormsWorklistTask({ defaults: { form: ["3"] } }) as ITask<DataPorts, DataPorts>);
    const loop = wf.forEach({ concurrencyLimit: 20 });
    loop.pipe(new ProgressTask() as ITask<DataPorts, DataPorts>);
    loop.endForEach();
    wf.pipe(new OutputTask() as ITask<DataPorts, DataPorts>);

    const messages: Array<string | undefined> = [];
    const iterator = wf.graph.getTasks().find((t) => (t as { type?: string }).type === "ForEachTask");
    expect(iterator).toBeDefined();
    iterator!.events.on("iteration_progress", (_i, _n, _p, message) => {
      messages.push(message);
    });

    await wf.run({});

    expect(messages).toContain("3 0000000001-26-000001 · working");
  });

  it("formsSweepLoop builds a runnable while+forEach sweep over the batches", async () => {
    // Exercises the exact production helper (not a hand-rolled copy) end to end.
    // ProcessAccessionDocFormTask has no primary_doc match here, so it
    // dead-letters PRIMARY_DOC_UNRESOLVED and returns {success:false} per
    // filing — the point is that the loop runs one iteration per filing without
    // throwing, proving addFormsSweepLoop wires the outer graph correctly.
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
