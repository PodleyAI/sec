/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ComputeFormsWorklistTask } from "./ComputeFormsWorklistTask";
import { addFormsSweepLoop } from "./formsSweep";
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

  it("addFormsSweepLoop builds a runnable loop over the producer's worklist", async () => {
    // Exercises the exact production helper (not a hand-rolled copy) end to end.
    // ProcessAccessionDocFormTask has no primary_doc match here, so it
    // dead-letters PRIMARY_DOC_UNRESOLVED and returns {success:false} per
    // filing — the point is that the loop runs one iteration per filing without
    // throwing, proving addFormsSweepLoop wires the outer graph correctly.
    await seed({ cik: 111, accession_number: "0000000001-26-000001", form: "3", primary_doc: "" });
    await seed({ cik: 222, accession_number: "0000000002-26-000002", form: "3", primary_doc: "" });

    const wf = new Workflow();
    wf.pipe(new ComputeFormsWorklistTask({ defaults: { form: ["3"] } }) as ITask<DataPorts, DataPorts>);
    addFormsSweepLoop(wf);
    wf.pipe(new OutputTask() as ITask<DataPorts, DataPorts>);

    await expect(wf.run({})).resolves.toBeDefined();
  });
});
