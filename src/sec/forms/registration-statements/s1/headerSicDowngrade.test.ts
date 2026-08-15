/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../../config/TestingDI";
import { setupAllDatabases } from "../../../../config/setupAllDatabases";
import { S1ClassificationRepo } from "../../../../storage/classification/S1ClassificationRepo";
import { ExtractionDeadLetterRepo } from "../../../../storage/dead-letter/ExtractionDeadLetterRepo";
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

function runArgs(cik: number, accession: string, summary: string) {
  return {
    cik,
    file_number: "333-1",
    accession_number: accession,
    filing_date: "2026-01-01",
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
});
