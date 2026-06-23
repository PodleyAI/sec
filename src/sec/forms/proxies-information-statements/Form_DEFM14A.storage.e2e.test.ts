/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { SpacMergerExtractionRepo } from "../../../storage/spac/SpacMergerExtractionRepo";
import {
  fakeS1Model,
  registerFakeStructuredProvider,
} from "../registration-statements/s1/testing/fakeStructuredProvider";
import { Form_DEFM14A } from "./Form_DEFM14A";
import { processMergerProxy } from "./Form_DEFM14A.storage";

const FIXTURE = `${import.meta.dir}/mock_data/merger-proxy/defm14a_sample.txt`;

// The stub model returns a fixed merger deal; source_span must appear verbatim
// in the fixture's "The Business Combination" section text (verifyRow gate).
function scriptMergerDeal(): () => void {
  const { unregister } = registerFakeStructuredProvider([
    {
      target_name: "Acme Target Inc.",
      pipe_amount: 150000000,
      merger_consideration: "$10.00 per share in stock",
      confidence: 0.95,
      source_span: "business combination with Acme Target Inc.",
    },
  ]);
  return unregister;
}

describe("processMergerProxy (e2e)", () => {
  let repo: SpacRepo;
  let cleanup: (() => void) | undefined;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacRepo();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  async function seedSpacWithOpenDeal(cik: number): Promise<void> {
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

  async function runProxy(cik: number, accession_number: string): Promise<void> {
    const txt = await Bun.file(FIXTURE).text();
    const parsed = await Form_DEFM14A.parse("DEFM14A", txt);
    await processMergerProxy({
      cik,
      file_number: "",
      accession_number,
      filing_date: "2021-05-01",
      primary_doc: "defm14a.htm",
      form: "DEFM14A",
      formMergerProxy: parsed,
      model: fakeS1Model(),
    });
  }

  it("extracts the target/pipe, correlates onto the deal, and rolls up to proxy", async () => {
    await seedSpacWithOpenDeal(100);
    cleanup = scriptMergerDeal();
    await runProxy(100, "100-defm");

    const extraction = await new SpacMergerExtractionRepo().getByAccession("100-defm");
    expect(extraction?.target_name).toBe("Acme Target Inc.");
    expect(extraction?.pipe_amount).toBe(150000000);
    expect(extraction?.merger_consideration).toBe("$10.00 per share in stock");

    const deals = await repo.getDeals(100);
    expect(deals).toHaveLength(1);
    expect(deals[0].target_name).toBe("Acme Target Inc.");
    expect(deals[0].pipe_amount).toBe(150000000);

    const events = await repo.getEvents(100);
    expect(events.filter((e) => e.event_type === "proxy")).toHaveLength(1);

    const row = await repo.getSpac(100);
    expect(row?.status).toBe("proxy");
    expect(row?.target_name).toBe("Acme Target Inc.");
    expect(row?.pipe_amount).toBe(150000000);
    expect(row?.proxy_date).toBe("2021-05-01");
  });

  it("writes nothing for a CIK with no spac row (gate)", async () => {
    cleanup = scriptMergerDeal();
    await runProxy(200, "200-defm");
    expect(await repo.getSpac(200)).toBeUndefined();
    expect(await new SpacMergerExtractionRepo().getByAccession("200-defm")).toBeUndefined();
    expect(await repo.getEvents(200)).toEqual([]);
  });

  it("is idempotent when the same proxy is reprocessed", async () => {
    await seedSpacWithOpenDeal(300);
    cleanup = scriptMergerDeal();
    await runProxy(300, "300-defm");
    await runProxy(300, "300-defm");

    const events = await repo.getEvents(300);
    expect(events.filter((e) => e.event_type === "proxy")).toHaveLength(1);
    expect(await repo.getDeals(300)).toHaveLength(1);
  });
});
