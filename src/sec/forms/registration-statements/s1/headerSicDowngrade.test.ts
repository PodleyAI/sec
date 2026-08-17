/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../../config/TestingDI";
import { setupAllDatabases } from "../../../../config/setupAllDatabases";
import { S1ClassificationRepo } from "../../../../storage/classification/S1ClassificationRepo";
import { ExtractionDeadLetterRepo } from "../../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../../../storage/filing/FilingSchema";
import { SpacRepo } from "../../../../storage/spac/SpacRepo";
import { processFormS1 } from "../Form_S_1.storage";
import { fakeS1Model } from "./testing/fakeStructuredProvider";

/** Filler so the summary clears MIN_SUMMARY_CHARS_TO_DEMOTE. */
const pad = (sentence: string, times: number) => Array(times).fill(sentence).join(" ");

const OPERATING_SUMMARY = pad(
  "We manufacture and distribute medical isotopes from our facility, and our revenue " +
    "for the period was derived from product sales to hospital customers.",
  20
);
const BLANK_CHECK_SUMMARY = pad(
  "We are a blank check company incorporated as a Cayman Islands exempted company for " +
    "the purpose of effecting an initial business combination, and the proceeds will be " +
    "held in the trust account until we complete our initial business combination.",
  20
);

function body(summary: string): string {
  return [
    `<h1>PROSPECTUS SUMMARY</h1><p>${summary}</p>`,
    "<h1>MANAGEMENT</h1><p>x</p>",
    "<h1>PRINCIPAL AND SELLING STOCKHOLDERS</h1><p>x</p>",
    "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1><p>x</p>",
  ].join("");
}

function runArgs(cik: number, accession: string, summary: string, filingDate = "2026-01-01") {
  return {
    cik,
    file_number: "333-1",
    accession_number: accession,
    filing_date: filingDate,
    primary_doc: `${accession}.txt`,
    form: "S-1",
    formS1: {
      header: {
        sic: 6770,
        sicDescription: "BLANK CHECKS",
        cik: null,
        companyName: "Example Corp",
        filingDate: null,
      },
      html: body(summary),
    } as never,
    model: fakeS1Model(),
  };
}

async function seedFiling(
  cik: number,
  accession: string,
  form: string,
  filingDate: string
): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik,
    accession_number: accession,
    form,
    primary_doc: `${form}.htm`,
    file_number: "",
    filing_date: filingDate,
    acceptance_date: `${filingDate}T00:00:00.000Z`,
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

describe("header-SIC downgrade", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("keeps a 6770 filing whose summary reads like a blank check", async () => {
    await processFormS1(runArgs(1848507, "0000000000-26-000001", BLANK_CHECK_SUMMARY));
    const row = await new S1ClassificationRepo().get("S-1", "0000000000-26-000001");
    expect(row?.is_spac).toBe(true);
    expect(row?.classifier_source).toBe("sgml-header");
    // A known-SPAC row is what gates the 8-K / proxy / Form 25-15 tier.
    expect(await new SpacRepo().getSpac(1848507)).toBeDefined();
  });

  it("demotes a 6770 filing whose summary is an operating company", async () => {
    // The shape of a post-de-SPAC S-1: the surviving company keeps the shell's
    // CIK and EDGAR keeps coding it 6770 long after the combination closed.
    await processFormS1(runArgs(2108121, "0000000000-26-000002", OPERATING_SUMMARY));
    const row = await new S1ClassificationRepo().get("S-1", "0000000000-26-000002");
    expect(row?.is_spac).toBe(false);
    expect(row?.classifier_source).toBe("sgml-header-rejected");
    expect(await new SpacRepo().getSpac(2108121)).toBeUndefined();
  });

  it("does not demote on a summary too short for its silence to mean anything", async () => {
    await processFormS1(runArgs(1849470, "0000000000-26-000003", "We make pumps."));
    const row = await new S1ClassificationRepo().get("S-1", "0000000000-26-000003");
    expect(row?.is_spac).toBe(true);
    expect(row?.classifier_source).toBe("sgml-header");
  });

  it("resolves the converter dead-letter when the tree segments normally", async () => {
    await processFormS1(runArgs(1848507, "0000000000-26-000004", BLANK_CHECK_SUMMARY));
    const pending = await new ExtractionDeadLetterRepo().listPending("S-1");
    expect(pending.some((e) => e.section_name === "converter")).toBe(false);
  });

  it("keeps a small blank-check shell whose summary says so only once", () => {
    // `Lucent, Inc.` (CIK 1778343), a Montana shell registering a $30,000
    // offering. Its summary states outright that it is a blank check company —
    // but that phrase is its ONLY signal, because a shell of this size has no
    // trust account, no founder shares and no sponsor. Demoting it deletes the
    // spac row for a filing that self-identifies as a blank check.
    const summary = pad(
      "The Company has been in the developmental stage since inception and has no " +
        "operations to date. The Company can be defined as a shell company, whose sole " +
        "purpose at this time is to locate and consummate a merger or acquisition with a " +
        "private entity. The proposed business activities described herein classify the " +
        "Company as a blank check company.",
      8
    );
    return processFormS1(runArgs(1778343, "0000000000-26-000005", summary)).then(async () => {
      const row = await new S1ClassificationRepo().get("S-1", "0000000000-26-000005");
      expect(row?.is_spac).toBe(true);
      expect(row?.classifier_source).toBe("sgml-header");
    });
  });

  it("never demotes a CIK that is already a known SPAC", async () => {
    // The shell keeps its CIK through the combination and renames, so a
    // post-combination registration statement reads like the operating company
    // it now is. That is the expected shape, not evidence the vehicle was never
    // a SPAC — and the spac row's three eras exist to carry exactly this.
    const cik = 2108121;
    await processFormS1(runArgs(cik, "0000000000-26-000010", BLANK_CHECK_SUMMARY));
    expect(await new SpacRepo().getSpac(cik)).toBeDefined();

    // A later filing on the same CIK whose prose is pure operating company.
    await processFormS1(runArgs(cik, "0000000000-26-000011", OPERATING_SUMMARY));
    const row = await new S1ClassificationRepo().get("S-1", "0000000000-26-000011");
    expect(row?.is_spac).toBe(true);
    expect(row?.classifier_source).toBe("sgml-header");
    expect(await new SpacRepo().getSpac(cik)).toBeDefined();
  });

  it("demotes on a retry even though its own earlier pass minted the row", async () => {
    // The two-run shape is the only one that reproduces this. FOUR paths in
    // processFormS1 record the registration before segmentation ever runs — no
    // model, S-1MEF, parse error, and the Part-II-only amendment — and
    // recordRegistration appends an event and rebuilds the spac row. So by the
    // time a `retry-dead-letters` run can finally read the prospectus, a spac
    // row for this CIK exists; a guard reading `getSpac(cik)` then treats the
    // filing's OWN earlier pass as prior evidence about itself and the
    // demotion never fires.
    const cik = 2108122;
    const accession = "0000000000-26-000020";

    // Pass 1: no model available. The deterministic header SIC stands and the
    // early path mints the spac row.
    const { model: _model, ...noModelArgs } = runArgs(cik, accession, OPERATING_SUMMARY);
    await processFormS1(noModelArgs);
    expect(await new SpacRepo().getSpac(cik)).toBeDefined();
    const first = await new S1ClassificationRepo().get("S-1", accession);
    expect(first?.is_spac).toBe(true);
    expect(first?.classifier_source).toBe("sgml-header");

    // Pass 2: the SAME accession, now with a model. The prospectus is readable,
    // reads as an operating company, and the only spac event on file is the one
    // this accession wrote — so it is not evidence, and the demotion fires.
    await processFormS1(runArgs(cik, accession, OPERATING_SUMMARY));
    const row = await new S1ClassificationRepo().get("S-1", accession);
    expect(row?.is_spac).toBe(false);
    expect(row?.classifier_source).toBe("sgml-header-rejected");
  });

  it("still refuses to demote when the prior event came from another accession", async () => {
    // The control for the narrowing above: evidence from a DIFFERENT accession
    // is real evidence, and the "once a blank check, always a SPAC CIK"
    // invariant must survive. Here a genuine earlier registration minted the
    // row, so the later operating-company prose is the expected post-de-SPAC
    // shape rather than grounds to detach the filing from its lifecycle row.
    const cik = 2108123;
    await processFormS1(runArgs(cik, "0000000000-26-000021", BLANK_CHECK_SUMMARY));
    expect(await new SpacRepo().getSpac(cik)).toBeDefined();

    await processFormS1(runArgs(cik, "0000000000-26-000022", OPERATING_SUMMARY));
    const row = await new S1ClassificationRepo().get("S-1", "0000000000-26-000022");
    expect(row?.is_spac).toBe(true);
    expect(row?.classifier_source).toBe("sgml-header");
    expect(await new SpacRepo().getSpac(cik)).toBeDefined();
  });

  it("still declines to mint a row for a CIK nothing knows about", async () => {
    // Same prose, no prior spac row: here the only question is whether a stale
    // header should MINT one, and it should not.
    await processFormS1(runArgs(2109999, "0000000000-26-000012", OPERATING_SUMMARY));
    const row = await new S1ClassificationRepo().get("S-1", "0000000000-26-000012");
    expect(row?.is_spac).toBe(false);
    expect(row?.classifier_source).toBe("sgml-header-rejected");
    expect(await new SpacRepo().getSpac(2109999)).toBeUndefined();
  });

  it("does not mint a spac row on a newco that already listed via S-4 + 8-A12B", async () => {
    // Live 2001557 Innventure: the pubco CIK keeps SIC 6770 on a later S-1,
    // and the summary still talks like a blank check because it recounts the
    // combination. The S-4 + 8-A12B already on file mean this CIK is the
    // surviving listed company, not a SPAC IPO.
    const cik = 2001557;
    await seedFiling(cik, "0000000000-24-000010", "S-4", "2024-09-01");
    await seedFiling(cik, "0000000000-24-000011", "8-A12B", "2024-10-02");
    await processFormS1(runArgs(cik, "0000000000-24-000012", BLANK_CHECK_SUMMARY));
    const row = await new S1ClassificationRepo().get("S-1", "0000000000-24-000012");
    expect(row?.is_spac).toBe(false);
    expect(row?.classifier_source).toBe("newco-listing");
    expect(await new SpacRepo().getSpac(cik)).toBeUndefined();
  });

  it("still mints the original 6770 S-1 when S-4 + 8-A12B arrive later (Redwoods)", async () => {
    const cik = 1907223;
    await seedFiling(cik, "0000000000-22-000010", "8-A12B", "2022-03-30");
    await seedFiling(cik, "0000000000-23-000011", "S-4", "2023-08-04");
    await processFormS1(runArgs(cik, "0000000000-22-000012", BLANK_CHECK_SUMMARY, "2022-03-10"));
    const row = await new S1ClassificationRepo().get("S-1", "0000000000-22-000012");
    expect(row?.is_spac).toBe(true);
    expect(row?.classifier_source).toBe("sgml-header");
    expect(await new SpacRepo().getSpac(cik)).toBeDefined();
  });

  it("still mints when the CIK has only an 8-A12B (SPAC IPO listing)", async () => {
    const cik = 2001558;
    await seedFiling(cik, "0000000000-24-000020", "8-A12B", "2024-10-02");
    await processFormS1(runArgs(cik, "0000000000-24-000021", BLANK_CHECK_SUMMARY));
    expect(await new SpacRepo().getSpac(cik)).toBeDefined();
  });

  it("does not un-mint a CIK that is already a known SPAC after its S-4", async () => {
    const cik = 2001559;
    await processFormS1(runArgs(cik, "0000000000-24-000030", BLANK_CHECK_SUMMARY));
    expect(await new SpacRepo().getSpac(cik)).toBeDefined();
    await seedFiling(cik, "0000000000-24-000031", "S-4", "2025-01-01");
    await seedFiling(cik, "0000000000-24-000032", "8-A12B", "2024-06-01");
    await processFormS1(runArgs(cik, "0000000000-24-000033", BLANK_CHECK_SUMMARY));
    expect(await new SpacRepo().getSpac(cik)).toBeDefined();
    const row = await new S1ClassificationRepo().get("S-1", "0000000000-24-000033");
    expect(row?.is_spac).toBe(true);
  });
});
