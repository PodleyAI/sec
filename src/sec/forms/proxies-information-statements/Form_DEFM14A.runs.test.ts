/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { ExtractorRunRepo } from "../../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../../storage/versioning/ExtractorRunSchema";
import {
  fakeS1Model,
  registerFakeStructuredProvider,
} from "../registration-statements/s1/testing/fakeStructuredProvider";
import { Form_DEFM14A } from "./Form_DEFM14A";
import { processMergerProxy } from "./Form_DEFM14A.storage";
import { fileURLToPath } from "node:url";
const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");

const FIXTURE = `${importMetaDir}/mock_data/merger-proxy/defm14a_sample.txt`;

async function seedSpac(cik: number): Promise<void> {
  const writer = new SpacReportWriter();
  await writer.recordRegistration({
    cik,
    accession_number: `${cik}-reg`,
    filing_date: "2020-12-01",
    form: "S-1",
    primary_document: "s1.htm",
    spac_name: "Merge SPAC Inc.",
    spac_sic: 6770,
  });
  await writer.recordDealMilestones({
    cik,
    accession_number: `${cik}-da`,
    filing_date: "2021-03-05",
    form: "8-K",
    primary_document: null,
    events: [{ event_type: "definitive_agreement", event_date: "2021-03-01" }],
  });
}

function scriptHappyPath(): () => void {
  const { unregister } = registerFakeStructuredProvider([
    {
      target_name: "Acme Target Inc.",
      pipe_amount: 150_000_000,
      merger_consideration: "$10.00 per share in stock",
      confidence: 0.95,
      source_span: "business combination with Acme Target Inc.",
    },
  ]);
  return unregister;
}

function getRunRepo(): ExtractorRunRepo {
  return new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
}

describe("processMergerProxy extractor_runs recording", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("records a successful run after a happy-path processMergerProxy", async () => {
    await seedSpac(900);
    cleanup = scriptHappyPath();
    const txt = await Bun.file(FIXTURE).text();
    const parsed = await Form_DEFM14A.parse("DEFM14A", txt);
    await processMergerProxy({
      cik: 900,
      file_number: "",
      accession_number: "900-defm",
      filing_date: "2021-05-01",
      primary_doc: "proxy.htm",
      form: "DEFM14A",
      formMergerProxy: parsed,
      model: fakeS1Model(),
    });

    const run = await getRunRepo().findRun(900, "900-defm", "merger-proxy", "1.0.0");
    expect(run).toBeDefined();
    expect(run?.success).toBe(true);
    expect(run?.error).toBeNull();
    expect(run?.slot_at_run).toBe("current");
    expect(run?.form).toBe("DEFM14A");
  });

  it("records a PARSE_ERROR failure when segmentation throws", async () => {
    await seedSpac(901);
    cleanup = scriptHappyPath();
    // Synthesize a FormS1Parsed whose `html` field will explode the parser /
    // segmenter — a missing tree root makes DocumentTreeSegmenter throw.
    // We bypass Form_DEFM14A.parse and inject a malformed FormS1Parsed
    // directly so the segmentation catch branch fires.
    await processMergerProxy({
      cik: 901,
      file_number: "",
      accession_number: "901-defm",
      filing_date: "2021-05-01",
      primary_doc: "proxy.htm",
      form: "DEFM14A",
      // `html` deliberately null-equivalent so parseEdgarHtml throws.
      formMergerProxy: {
        header: {} as unknown as never,
        html: null as unknown as string,
      } as never,
      model: fakeS1Model(),
    });

    const run = await getRunRepo().findRun(901, "901-defm", "merger-proxy", "1.0.0");
    expect(run).toBeDefined();
    expect(run?.success).toBe(false);
    expect(run?.error?.startsWith("PARSE_ERROR:")).toBe(true);
  });

  it("writes no extractor_runs row when the CIK has no spac row (gate)", async () => {
    cleanup = scriptHappyPath();
    const txt = await Bun.file(FIXTURE).text();
    const parsed = await Form_DEFM14A.parse("DEFM14A", txt);
    await processMergerProxy({
      cik: 999,
      file_number: "",
      accession_number: "999-defm",
      filing_date: "2021-05-01",
      primary_doc: "proxy.htm",
      form: "DEFM14A",
      formMergerProxy: parsed,
      model: fakeS1Model(),
    });

    const run = await getRunRepo().findRun(999, "999-defm", "merger-proxy", "1.0.0");
    expect(run).toBeUndefined();
  });
});
