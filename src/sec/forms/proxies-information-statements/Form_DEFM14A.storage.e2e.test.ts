/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { SpacMergerExtractionRepo } from "../../../storage/spac/SpacMergerExtractionRepo";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import {
  fakeS1Model,
  registerFakeStructuredProvider,
} from "../registration-statements/s1/testing/fakeStructuredProvider";
import { Form_8_K } from "../miscellaneous-filings/Form_8_K";
import { processForm8K } from "../miscellaneous-filings/Form_8_K.storage";
import { Form_DEFM14A } from "./Form_DEFM14A";
import { processMergerProxy } from "./Form_DEFM14A.storage";
import { fileURLToPath } from "node:url";
const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");

const FIXTURE = `${importMetaDir}/mock_data/merger-proxy/defm14a_sample.txt`;

// The stub model returns a fixed merger deal; source_span must appear verbatim
// in the fixture's "The Business Combination" section text (verifyRow gate).
function scriptMergerDeal(): () => void {
  const { unregister } = registerFakeStructuredProvider([
    {
      target_name: "Acme Target Inc.",
      target_description: "Acme Target is a commercial EV manufacturer.",
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

  /** The fixture submission with its prospectus body swapped out. */
  function submissionWithBody(body: string): string {
    const txt = readFileSync(FIXTURE, "utf-8");
    return txt.replace(/<body>[\s\S]*<\/body>/, `<body>\n${body}\n</body>`);
  }

  async function runProxy(
    cik: number,
    accession_number: string,
    form = "DEFM14A",
    filing_date = "2021-05-01",
    txt = readFileSync(FIXTURE, "utf-8")
  ): Promise<void> {
    const parsed = await Form_DEFM14A.parse(form, txt);
    await processMergerProxy({
      cik,
      file_number: "",
      accession_number,
      filing_date,
      primary_doc: "proxy.htm",
      form,
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
    expect(row?.target_description).toBe("Acme Target is a commercial EV manufacturer.");
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

  it("emits a proxy event for a definitive consent statement (DEFM14C)", async () => {
    await seedSpacWithOpenDeal(110);
    cleanup = scriptMergerDeal();
    await runProxy(110, "110-defm14c", "DEFM14C");

    const events = await repo.getEvents(110);
    expect(events.filter((e) => e.event_type === "proxy")).toHaveLength(1);
    const row = await repo.getSpac(110);
    expect(row?.status).toBe("proxy");
    expect(row?.target_name).toBe("Acme Target Inc.");
  });

  it("emits a proxy event for a DEF 14A whose merger section yields a deal", async () => {
    // Most SPACs vote their combination on a plain DEF 14A, never a DEFM14A.
    await seedSpacWithOpenDeal(120);
    cleanup = scriptMergerDeal();
    await runProxy(120, "120-def14a", "DEF 14A");

    const events = await repo.getEvents(120);
    expect(events.filter((e) => e.event_type === "proxy")).toHaveLength(1);
    const row = await repo.getSpac(120);
    expect(row?.status).toBe("proxy");
    expect(row?.proxy_date).toBe("2021-05-01");
    expect(row?.target_name).toBe("Acme Target Inc.");
  });

  it("emits no proxy event for a DEF 14A extension proxy with no merger section", async () => {
    // The form symbol is not evidence: an extension vote is the common DEF 14A.
    // Its proposal heading matches none of the merger section patterns, so no
    // deal is extracted and the approval stage must not advance.
    await seedSpacWithOpenDeal(121);
    cleanup = scriptMergerDeal();
    await runProxy(
      121,
      "121-def14a-ext",
      "DEF 14A",
      "2021-05-01",
      submissionWithBody(
        "<h1>Extension Amendment Proposal</h1>\n" +
          "<p>To amend the Company's charter to extend the date by which it must " +
          "consummate an initial business combination.</p>"
      )
    );

    const events = await repo.getEvents(121);
    expect(events.some((e) => e.event_type === "proxy")).toBe(false);
    expect(await new SpacMergerExtractionRepo().getByAccession("121-def14a-ext")).toBeUndefined();
    expect((await repo.getSpac(121))?.status).toBe("deal_announced");
  });

  it("does not emit a proxy event for a preliminary proxy (PRE 14A) that yields a deal", async () => {
    await seedSpacWithOpenDeal(122);
    cleanup = scriptMergerDeal();
    await runProxy(122, "122-pre14a", "PRE 14A");

    const events = await repo.getEvents(122);
    expect(events.some((e) => e.event_type === "proxy")).toBe(false);
    const row = await repo.getSpac(122);
    expect(row?.status).toBe("deal_announced");
    expect(row?.target_name).toBe("Acme Target Inc."); // extraction-only, still correlated
  });

  it("a DEF 14A proxy event makes the following item 5.07 a merger vote", async () => {
    await seedSpacWithOpenDeal(123);
    cleanup = scriptMergerDeal();
    await runProxy(123, "123-def14a", "DEF 14A");

    const form8K = await Form_8_K.parse("8-K", "<html/>");
    await processForm8K({
      cik: 123,
      accession_number: "123-vote",
      filing_date: "2021-06-01",
      form: "8-K",
      items: "5.07",
      report_date: "2021-06-01",
      form8K,
      extractor_id: "8-K",
      extractor_version: "1.0.0",
    });

    const events = await repo.getEvents(123);
    expect(events.some((e) => e.event_type === "vote")).toBe(true);
    expect((await repo.getSpac(123))?.vote_date).toBe("2021-06-01");
  });

  it("does not emit a proxy event for a preliminary consent statement (PREM14C)", async () => {
    await seedSpacWithOpenDeal(111);
    cleanup = scriptMergerDeal();
    await runProxy(111, "111-prem14c", "PREM14C");

    const events = await repo.getEvents(111);
    expect(events.some((e) => e.event_type === "proxy")).toBe(false);
    const row = await repo.getSpac(111);
    expect(row?.status).toBe("deal_announced");
    expect(row?.target_name).toBe("Acme Target Inc."); // still correlated
  });

  it("does not emit a proxy event for a preliminary revised proxy (PRER14A)", async () => {
    await seedSpacWithOpenDeal(113);
    cleanup = scriptMergerDeal();
    await runProxy(113, "113-prer14a", "PRER14A");

    const events = await repo.getEvents(113);
    expect(events.some((e) => e.event_type === "proxy")).toBe(false);
    const row = await repo.getSpac(113);
    expect(row?.status).toBe("deal_announced");
    expect(row?.target_name).toBe("Acme Target Inc."); // extraction-only, still correlated
  });

  it("a revised proxy (DEFR14A) supersedes target/pipe without a second proxy event", async () => {
    await seedSpacWithOpenDeal(112);
    const dealWithPipe = (pipe_amount: number) => [
      {
        target_name: "Acme Target Inc.",
        pipe_amount,
        merger_consideration: "$10.00 per share in stock",
        confidence: 0.95,
        source_span: "business combination with Acme Target Inc.",
      },
    ];

    // Definitive proxy first: emits the proxy event + initial PIPE.
    let registration = registerFakeStructuredProvider(dealWithPipe(150000000));
    cleanup = registration.unregister; // guard against a throw inside runProxy
    await runProxy(112, "112-defm", "DEFM14A", "2021-05-01");
    registration.unregister();
    cleanup = undefined;

    // Revised definitive proxy, filed later -> its extraction wins correlation.
    registration = registerFakeStructuredProvider(dealWithPipe(225000000));
    cleanup = registration.unregister;
    await runProxy(112, "112-defr", "DEFR14A", "2021-05-10");

    const events = await repo.getEvents(112);
    expect(events.filter((e) => e.event_type === "proxy")).toHaveLength(1); // only DEFM14A
    const deals = await repo.getDeals(112);
    expect(deals[0].pipe_amount).toBe(225000000); // revised value wins (later filing_date)
  });
});
