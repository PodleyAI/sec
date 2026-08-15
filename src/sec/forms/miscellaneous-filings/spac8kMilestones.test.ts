/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { EntityRepo } from "../../../storage/entity/EntityRepo";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../../../storage/spac/SpacCandidateSchema";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import type { SubmissionExhibit } from "../registration-statements/s1/parseSubmission";
import { Form_8_K } from "./Form_8_K";
import { processForm8K } from "./Form_8_K.storage";
import { extractMergerCounterparty, mapItemCodesToSpacEvents } from "./spac8kMilestones";

const emptyCtx = {
  ipoDate: null as string | null,
  registrationDate: null as string | null,
  exhibits: [] as SubmissionExhibit[],
  pendingDeal: null,
};

const mergerEx: SubmissionExhibit = {
  type: "EX-2.1",
  description: "AGREEMENT AND PLAN OF MERGER, DATED AUGUST 31, 2021",
  filename: "ex21.htm",
};
const uwEx: SubmissionExhibit = {
  type: "EX-1.1",
  description: "UNDERWRITING AGREEMENT, DATED JANUARY 14, 2021, BY AND BETWEEN THE COMPANY AND C",
  filename: "ex11.htm",
};

describe("mapItemCodesToSpacEvents", () => {
  it("maps a post-IPO EX-2 merger 1.01 to definitive_agreement and stores exhibits", () => {
    const events = mapItemCodesToSpacEvents(["1.01"], "2021-08-31", {
      ipoDate: "2021-01-27",
      registrationDate: null,
      exhibits: [mergerEx],
      pendingDeal: null,
    });
    expect(events.map((e) => e.event_type)).toEqual(["definitive_agreement"]);
    expect(events[0].detail).toContain("EX-2.1");
    expect(events[0].detail).toContain("ex21.htm");
  });

  it("maps a post-IPO EX-2.1 whose description is just the type (Northern Star / Apex) to DA", () => {
    expect(
      mapItemCodesToSpacEvents(["1.01"], "2021-02-21", {
        ipoDate: "2021-01-27",
        registrationDate: null,
        exhibits: [
          { type: "EX-2.1", description: "EX-2.1", filename: "d137294dex21.htm" },
          { type: "EX-10.1", description: "EX-10.1", filename: "d137294dex101.htm" },
        ],
        pendingDeal: null,
      })[0].event_type
    ).toBe("definitive_agreement");
  });

  it("does not treat an informative non-merger EX-2 as a DA", () => {
    expect(
      mapItemCodesToSpacEvents(["1.01"], "2021-02-21", {
        ipoDate: "2021-01-27",
        registrationDate: null,
        exhibits: [
          {
            type: "EX-2.1",
            description: "ASSET PURCHASE AGREEMENT, DATED FEBRUARY 21, 2021",
            filename: "ex21.htm",
          },
        ],
        pendingDeal: null,
      })[0].event_type
    ).toBe("material_agreement");
  });

  it("maps a pre-IPO 1.01 and a post-IPO underwriting 1.01 to material_agreement", () => {
    expect(
      mapItemCodesToSpacEvents(["1.01"], "2021-01-25", {
        ipoDate: "2021-01-27",
        registrationDate: null,
        exhibits: [uwEx],
        pendingDeal: null,
      })[0].event_type
    ).toBe("material_agreement");
    expect(
      mapItemCodesToSpacEvents(["1.01"], "2021-02-21", {
        ipoDate: "2021-01-27",
        registrationDate: null,
        exhibits: [uwEx],
        pendingDeal: { definitive_agreement_date: null, proxy_date: null },
      })[0].event_type
    ).toBe("material_agreement");
  });

  it("maps 1.02 to terminated only when a pending deal exists or exhibits are merger-shaped", () => {
    expect(
      mapItemCodesToSpacEvents(["1.02"], "2021-11-30", {
        ipoDate: "2021-01-27",
        registrationDate: null,
        exhibits: [],
        pendingDeal: { definitive_agreement_date: "2021-08-31", proxy_date: null },
      })[0].event_type
    ).toBe("terminated");
    expect(
      mapItemCodesToSpacEvents(["1.02"], "2021-02-01", {
        ipoDate: "2021-01-27",
        registrationDate: null,
        exhibits: [uwEx],
        pendingDeal: null,
      })[0].event_type
    ).toBe("material_agreement");
  });

  it("maps 5.07 to vote only when a pending deal has a DA or proxy date", () => {
    expect(
      mapItemCodesToSpacEvents(["5.07"], "2021-06-01", {
        ipoDate: "2021-01-27",
        registrationDate: null,
        exhibits: [],
        pendingDeal: { definitive_agreement_date: "2021-03-01", proxy_date: null },
      })[0].event_type
    ).toBe("vote");
    expect(
      mapItemCodesToSpacEvents(["5.07"], "2021-06-01", {
        ipoDate: "2021-01-27",
        registrationDate: null,
        exhibits: [],
        pendingDeal: null,
      })[0].event_type
    ).toBe("eight_k");
  });

  it("still maps 2.01 to completed", () => {
    expect(
      mapItemCodesToSpacEvents(["2.01"], "2021-06-15", {
        ipoDate: "2021-01-27",
        registrationDate: null,
        exhibits: [],
        pendingDeal: { definitive_agreement_date: "2021-03-01", proxy_date: null },
      })[0].event_type
    ).toBe("completed");
  });

  it("maps a merger 1.01 to definitive_agreement when ipo_date is unknown", () => {
    // A SPAC row minted by the S-1 AI content classifier (SIC-miscoded filer)
    // never gets an `ipo` event, so ipo_date stays null. Absence of the date is
    // not evidence that the filing predates the IPO — only a known earlier
    // anchor is.
    expect(
      mapItemCodesToSpacEvents(["1.01"], "2021-08-31", {
        ipoDate: null,
        registrationDate: "2020-11-01",
        exhibits: [mergerEx],
        pendingDeal: null,
      })[0].event_type
    ).toBe("definitive_agreement");
  });

  it("maps a merger 1.01 to definitive_agreement when no date anchor is known at all", () => {
    expect(
      mapItemCodesToSpacEvents(["1.01"], "2021-08-31", {
        ipoDate: null,
        registrationDate: null,
        exhibits: [mergerEx],
        pendingDeal: null,
      })[0].event_type
    ).toBe("definitive_agreement");
  });

  it("still demotes a merger-shaped 1.01 dated before the registration date", () => {
    expect(
      mapItemCodesToSpacEvents(["1.01"], "2020-06-01", {
        ipoDate: null,
        registrationDate: "2021-01-01",
        exhibits: [mergerEx],
        pendingDeal: null,
      })[0].event_type
    ).toBe("material_agreement");
  });

  it("ignores non-milestone item codes", () => {
    expect(mapItemCodesToSpacEvents(["2.02", "9.01", "7.01"], "2021-03-01", emptyCtx)).toEqual([]);
  });

  it("prefixes the merger counterparty on a DA when the 8-K names it", () => {
    const events = mapItemCodesToSpacEvents(["1.01"], "2021-02-21", {
      ipoDate: "2021-01-27",
      registrationDate: null,
      exhibits: [mergerEx],
      pendingDeal: null,
      issuerName: "Northern Star Investment Corp. II",
      narrative:
        "On February 21, 2021, Northern Star Investment Corp. II, a Delaware corporation " +
        '("Northern Star"), entered into an Agreement and Plan of Reorganization ' +
        '("Merger Agreement") by and among Northern Star, NISC II-A Merger LLC, a Delaware ' +
        "limited liability company and wholly-owned subsidiary of Northern Star " +
        '("Merger Sub I"), Apex Clearing Holdings LLC, a Delaware limited liability ' +
        'company ("Apex") and, solely for the purposes of Section 5.21 therein, ' +
        "PEAK6 Investments LLC, a Delaware limited liability company.",
    });
    expect(events[0].event_type).toBe("definitive_agreement");
    expect(events[0].detail?.split("\n")[0]).toBe("# Apex Clearing Holdings LLC");
    expect(events[0].detail).toContain("EX-2.1");
  });
});

describe("extractMergerCounterparty", () => {
  it("picks the operating company from a by-and-among merger 8-K", () => {
    expect(
      extractMergerCounterparty(
        "entered into an Agreement and Plan of Reorganization (\"Merger Agreement\") " +
          "by and among Northern Star, NISC II-A Merger LLC, a Delaware limited liability " +
          "company and wholly-owned subsidiary of Northern Star (\"Merger Sub I\"), " +
          "Apex Clearing Holdings LLC, a Delaware limited liability company (\"Apex\") " +
          "and, solely for the purposes of Section 5.21 therein, PEAK6 Investments LLC.",
        "Northern Star Investment Corp. II"
      )
    ).toBe("Apex Clearing Holdings LLC");
  });

  it("picks a UK Plc named after with (PHP Ventures / Modulex)", () => {
    expect(
      extractMergerCounterparty(
        'PHP Ventures Acquisition Corp., a Delaware corporation ("PHP") entered into a ' +
          'definitive Business Combination Agreement (the "Business Combination Agreement") ' +
          "with Modulex Modular Buildings Plc, a company registered in England and Wales " +
          'with company number 07291662 ("Modulex") and Modulex Merger Sub, a to-be-formed ' +
          "Cayman Islands exempted company and wholly-owned subsidiary of Modulex " +
          '("Merger Sub").',
        "PHP Ventures Acquisition Corp."
      )
    ).toBe("Modulex Modular Buildings Plc");
  });

  it("picks the company named after with in a business combination 8-K", () => {
    expect(
      extractMergerCounterparty(
        "the Company entered into a Business Combination Agreement with Lucid Group, Inc., " +
          "a Delaware corporation (\"Lucid\").",
        "Churchill Capital Corp IV"
      )
    ).toBe("Lucid Group, Inc.");
  });

  it("does not stop the party list at the period in Inc.", () => {
    expect(
      extractMergerCounterparty(
        "Test SPAC entered into an Agreement and Plan of Merger by and among Test SPAC, " +
          "Test Merger Sub Inc., a Delaware corporation and wholly-owned subsidiary of " +
          "Test SPAC, and Acme Robotics, Inc., a Delaware corporation.",
        "Test SPAC"
      )
    ).toBe("Acme Robotics, Inc.");
  });

  it("treats legal-form suffixes as case-insensitive, including dotted LP and GP", () => {
    const narrative = (suffix: string): string =>
      `the Company entered into a Business Combination Agreement with Acme Robotics ${suffix}, ` +
      `a Delaware limited liability company ("Acme").`;
    for (const suffix of [
      "inc.",
      "Incorporated",
      "L.L.C.",
      "l.l.c.",
      "L.P.",
      "lp",
      "G.P.",
      "gp",
      "Plc",
    ] as const) {
      expect(extractMergerCounterparty(narrative(suffix), "Test SPAC")).toBe(
        `Acme Robotics ${suffix}`
      );
    }
  });

  it("names the operating counterparty, not the jurisdiction clause", () => {
    // The regressed sentence, verbatim. With a fully case-folded legal-form
    // alternation the party scan matched "Delaware corporation" as if it were
    // a company name, and — appearing before the real second party — that
    // string was returned and persisted as the definitive_agreement event's
    // `detail`.
    expect(
      extractMergerCounterparty(
        "Agreement and Plan of Merger, by and among Acme Acquisition Corp., a Delaware " +
          'corporation ("Company"), and Target Holdings, Inc., a Delaware corporation.',
        "Acme Acquisition Corp."
      )
    ).toBe("Target Holdings, Inc.");
  });

  it("does not read a word prefix as a two-letter legal form", () => {
    // "Business Combination Agreement" opens the merger window, and a folded
    // `AG` matched the "Ag" of "Agreement", so the party scan produced
    // "Business Combination Ag" before the real counterparty was reached.
    expect(
      extractMergerCounterparty(
        "Test SPAC entered into a Business Combination Agreement, by and among Test SPAC " +
          "and Target Holdings, Inc., a Delaware corporation.",
        "Test SPAC"
      )
    ).toBe("Target Holdings, Inc.");
  });

  it("reads an ALL-CAPS party list the way filers shout it in exhibits", () => {
    // Word-shaped forms keep the filing's capitalisation, so an all-caps
    // exhibit needs its own alternative: without it "TARGET HOLDINGS, INC."
    // is still found (INC is short enough to stay folded) but a party whose
    // only form is "CORP." or "CORPORATION" is not.
    expect(
      extractMergerCounterparty(
        "Agreement and Plan of Merger, by and among BIG SPAC CORP., MERGER SUB INC., and " +
          "TARGET HOLDINGS, INC., a Delaware corporation",
        "Big Spac Corp."
      )
    ).toBe("TARGET HOLDINGS, INC.");
  });

  it("still matches a lowercase plc, which filers really do write", () => {
    expect(
      extractMergerCounterparty(
        "Agreement and Plan of Merger, by and among Foo Acquisition Corp. and Rockley " +
          "Photonics Holdings plc, an English public limited company.",
        "Foo Acquisition Corp."
      )
    ).toBe("Rockley Photonics Holdings plc");
  });

  it("keeps the trailing dot of a dotted form (L.P.)", () => {
    // This is exactly why each alternative is closed with a negative lookahead
    // rather than `\b`: a word boundary after the optional dot would refuse to
    // consume it, truncating "Blackstone Holdings L.P." to
    // "Blackstone Holdings L.P" — a name that was never filed.
    expect(
      extractMergerCounterparty(
        "the Company entered into a Business Combination Agreement with Blackstone " +
          "Holdings L.P., a Delaware limited partnership.",
        "Test SPAC"
      )
    ).toBe("Blackstone Holdings L.P.");
  });

  it("returns null when the narrative is not a merger agreement", () => {
    expect(
      extractMergerCounterparty(
        "the Company entered into an Underwriting Agreement with Goldman Sachs & Co. LLC.",
        "Test SPAC"
      )
    ).toBeNull();
  });
});

describe("processForm8K SPAC milestone wiring", () => {
  let repo: SpacRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacRepo();
  });

  async function seedSpac(cik: number): Promise<void> {
    await new SpacReportWriter().recordRegistration({
      cik,
      accession_number: `${cik}-reg`,
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Test SPAC",
      spac_sic: 6770,
    });
  }

  async function seedIpo(cik: number): Promise<void> {
    await new SpacReportWriter().recordIpo({
      cik,
      accession_number: `${cik}-ipo`,
      filing_date: "2021-01-27",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 100,
      trust_amount: 100,
      spac_tickers: ["TEST"],
    });
  }

  const mergerTxt = (date: string): string =>
    `<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<FILENAME>d8k.htm\n<DESCRIPTION>CURRENT REPORT\n<TEXT>\n<html/>\n</TEXT>\n</DOCUMENT>\n` +
    `<DOCUMENT>\n<TYPE>EX-2.1\n<SEQUENCE>2\n<FILENAME>ex21.htm\n<DESCRIPTION>AGREEMENT AND PLAN OF MERGER, DATED ${date}\n<TEXT>\n<html/>\n</TEXT>\n</DOCUMENT>\n`;

  const underwritingTxt =
    `<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<FILENAME>d8k.htm\n<DESCRIPTION>CURRENT REPORT\n<TEXT>\n<html/>\n</TEXT>\n</DOCUMENT>\n` +
    `<DOCUMENT>\n<TYPE>EX-1.1\n<SEQUENCE>2\n<FILENAME>ex11.htm\n<DESCRIPTION>UNDERWRITING AGREEMENT, DATED JANUARY 14, 2021, BY AND BETWEEN THE COMPANY AND C\n<TEXT>\n<html/>\n</TEXT>\n</DOCUMENT>\n`;

  async function run8K(
    cik: number,
    accession_number: string,
    items: string,
    report_date: string,
    fullSubmissionText?: string
  ): Promise<void> {
    const form8K = await Form_8_K.parse("8-K", "<html/>");
    await processForm8K({
      cik,
      accession_number,
      filing_date: report_date,
      form: "8-K",
      items,
      report_date,
      form8K,
      fullSubmissionText,
    });
  }

  async function seedSpacCandidate(cik: number): Promise<void> {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put({
      cik,
      name: "Screened Acquisition Corp",
      current_sic: 6770,
      signal_sic_6770: true,
      signal_name_match: true,
      signal_renamed_from: null,
      first_reg_form: "S-1",
      first_reg_date: "2020-11-01",
      reg_while_spac_named: true,
      confidence: "high",
      identified_at: "2026-01-01T00:00:00.000Z",
    });
  }

  it("stays silent about a missing SPAC row for an issuer the screen never flagged", async () => {
    // 1.01 / 2.01 / 5.07 are ordinary 8-K items every operating company files,
    // so warning on the item codes alone fired on most 8-Ks in a corpus sweep.
    // A warning that common is unreadable at volume, which costs exactly the
    // cases it exists to surface.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await run8K(700, "700-da", "1.01", "2021-03-01");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("warns about a missing SPAC row when the submissions screen flagged the issuer", async () => {
    // `spac_candidate` is independent, document-free evidence that this CIK
    // looks like a SPAC, so a dropped milestone here is worth an operator's
    // attention.
    await seedSpacCandidate(701);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await run8K(701, "701-da", "1.01", "2021-03-01");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("has no SPAC row");
    } finally {
      warn.mockRestore();
    }
  });

  it("advances a known SPAC through DA -> vote -> completion", async () => {
    await seedSpac(100);
    await seedIpo(100);
    await run8K(100, "100-da", "1.01,9.01", "2021-03-01", mergerTxt("2021-03-01"));
    await run8K(100, "100-vote", "5.07", "2021-06-01");
    await run8K(100, "100-close", "2.01,5.01", "2021-06-15");

    const row = await repo.getSpac(100);
    expect(row?.status).toBe("completed");
    expect(row?.definitive_agreement_date).toBe("2021-03-01");
    expect(row?.vote_date).toBe("2021-06-01");
    expect(row?.completed_date).toBe("2021-06-15");

    const deals = await repo.getDeals(100);
    expect(deals.length).toBe(1);
    expect(deals[0].outcome).toBe("completed");
  });

  it("links post-merger identity from entity metadata on the item 2.01 close", async () => {
    await seedSpac(150);
    // Post-close submissions have renamed the surviving operating company.
    await new EntityRepo().saveEntity({
      cik: 150,
      name: "Combined Operating Co, Inc.",
      type: null,
      sic: 3711,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: null,
      state_incorporation_desc: null,
    });
    await new EntityRepo().saveEntityTicker({ cik: 150, ticker: "COCO", exchange: "NASDAQ" });

    await run8K(150, "150-close", "2.01", "2021-06-15");

    const row = await repo.getSpac(150);
    expect(row?.status).toBe("completed");
    expect(row?.surviving_name).toBe("Combined Operating Co, Inc.");
    expect(row?.current_name).toBe("Combined Operating Co, Inc.");
    expect(row?.post_merger_sic).toBe(3711);
    expect(JSON.parse(row!.post_merger_tickers!)).toEqual(["COCO"]);
    expect(row?.spac_name).toBe("Test SPAC"); // shell name preserved
  });

  it("writes no SPAC events for a CIK with no spac row", async () => {
    await run8K(200, "200-da", "1.01,9.01", "2021-03-01");
    expect(await repo.getSpac(200)).toBeUndefined();
    expect(await repo.getEvents(200)).toEqual([]);
    expect(await repo.getDeals(200)).toEqual([]);
  });

  it("uses report_date as the event date and is idempotent on reprocess", async () => {
    await seedSpac(300);
    await seedIpo(300);
    await run8K(300, "300-da", "1.01", "2021-03-01", mergerTxt("2021-03-01"));
    await run8K(300, "300-da", "1.01", "2021-03-01", mergerTxt("2021-03-01")); // reprocess

    const events = await repo.getEvents(300);
    expect(events.filter((e) => e.event_type === "definitive_agreement").length).toBe(1);
    expect(events.find((e) => e.event_type === "definitive_agreement")?.event_date).toBe(
      "2021-03-01"
    );
    const deals = await repo.getDeals(300);
    expect(deals.length).toBe(1);
  });

  it("prefers report_date over filing_date for the event date", async () => {
    await seedSpac(400);
    await seedIpo(400);
    const form8K = await Form_8_K.parse("8-K", "<html/>");
    await processForm8K({
      cik: 400,
      accession_number: "400-da",
      filing_date: "2021-03-10", // later than the report/triggering date
      form: "8-K",
      items: "1.01",
      report_date: "2021-03-01", // the actual triggering-event date
      form8K,
      fullSubmissionText: mergerTxt("2021-03-01"),
    });

    const events = await repo.getEvents(400);
    const da = events.find((e) => e.event_type === "definitive_agreement");
    expect(da?.event_date).toBe("2021-03-01");
    const deals = await repo.getDeals(400);
    expect(deals[0].definitive_agreement_date).toBe("2021-03-01");
  });

  it("records no milestone when neither report_date nor filing_date is available", async () => {
    await seedSpac(500);
    const form8K = await Form_8_K.parse("8-K", "<html/>");
    await processForm8K({
      cik: 500,
      accession_number: "500-da",
      filing_date: "", // best-effort path: filing-metadata row absent
      form: "8-K",
      items: "1.01",
      report_date: null,
      form8K,
    });

    // An undated 8-K must not write a milestone (empty event_date would be junk).
    const events = await repo.getEvents(500);
    expect(events.some((e) => e.event_type === "definitive_agreement")).toBe(false);
    expect(await repo.getDeals(500)).toEqual([]);
  });

  it("stores DA exhibits and the named merger counterparty from the 8-K body", async () => {
    await seedSpac(800);
    await seedIpo(800);
    const body =
      `<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<FILENAME>d8k.htm\n<DESCRIPTION>CURRENT REPORT\n<TEXT>\n` +
      `<html><body><p>Item 1.01 Entry into a Material Definitive Agreement.</p>` +
      `<p>On March 1, 2021, Test SPAC entered into an Agreement and Plan of Merger ` +
      `by and among Test SPAC, Test Merger Sub Inc., a Delaware corporation and ` +
      `wholly-owned subsidiary of Test SPAC, and Acme Robotics, Inc., a Delaware ` +
      `corporation ("Acme").</p></body></html>\n</TEXT>\n</DOCUMENT>\n` +
      `<DOCUMENT>\n<TYPE>EX-2.1\n<SEQUENCE>2\n<FILENAME>ex21.htm\n` +
      `<DESCRIPTION>AGREEMENT AND PLAN OF MERGER, DATED MARCH 1, 2021\n<TEXT>\n<html/>\n</TEXT>\n</DOCUMENT>\n`;
    await run8K(800, "800-da", "1.01,9.01", "2021-03-01", body);

    const da = (await repo.getEvents(800)).find((e) => e.event_type === "definitive_agreement");
    expect(da?.detail?.split("\n")[0]).toBe("# Acme Robotics, Inc.");
    expect(da?.detail).toContain("EX-2.1");
    expect(da?.detail).toContain("ex21.htm");
  });

  it("writes a post-IPO underwriting 1.01 as material_agreement, not a DA", async () => {
    await seedSpac(600);
    await seedIpo(600);
    await run8K(600, "600-uw", "1.01,9.01", "2021-02-21", underwritingTxt);

    const events = await repo.getEvents(600);
    expect(events.some((e) => e.event_type === "definitive_agreement")).toBe(false);
    const misc = events.find((e) => e.event_type === "material_agreement");
    expect(misc?.event_date).toBe("2021-02-21");
    expect(misc?.detail).toContain("EX-1.1");
    expect(misc?.detail).toContain("ex11.htm");
    expect((await repo.getSpac(600))?.definitive_agreement_date).toBeNull();
    expect(await repo.getDeals(600)).toEqual([]);
  });

  it("replaying DA -> vote -> completion twice yields identical events, deals and row", async () => {
    // `sec spac process` re-runs every filing on every invocation, so the second
    // pass classifies each 8-K again. Classification must depend only on the
    // events dated before the filing, never on the deal set the LATER filings
    // already produced.
    await seedSpac(900);
    await seedIpo(900);
    const replay = async (): Promise<void> => {
      await run8K(900, "900-da", "1.01,9.01", "2021-03-01", mergerTxt("2021-03-01"));
      await run8K(900, "900-vote", "5.07", "2021-06-01");
      await run8K(900, "900-close", "2.01,5.01", "2021-06-15");
    };
    await replay();
    await replay();

    const events = await repo.getEvents(900);
    expect(events.filter((e) => e.event_type === "vote").length).toBe(1);
    expect(events.find((e) => e.event_type === "vote")?.event_date).toBe("2021-06-01");
    expect(events.some((e) => e.event_type === "eight_k")).toBe(false);

    const deals = await repo.getDeals(900);
    expect(deals.length).toBe(1);
    expect(deals[0].outcome).toBe("completed");

    const row = await repo.getSpac(900);
    expect(row?.vote_date).toBe("2021-06-01");
    expect(row?.status).toBe("completed");
  });

  it("replaying DA -> termination twice keeps the deal terminated", async () => {
    await seedSpac(910);
    await seedIpo(910);
    const replay = async (): Promise<void> => {
      await run8K(910, "910-da", "1.01,9.01", "2021-03-01", mergerTxt("2021-03-01"));
      await run8K(910, "910-term", "1.02", "2021-11-30");
    };
    await replay();
    await replay();

    const events = await repo.getEvents(910);
    expect(events.filter((e) => e.event_type === "terminated").length).toBe(1);
    expect(
      events.some((e) => e.accession_number === "910-term" && e.event_type === "material_agreement")
    ).toBe(false);

    const deals = await repo.getDeals(910);
    expect(deals.length).toBe(1);
    expect(deals[0].outcome).toBe("terminated");
    expect((await repo.getSpac(910))?.status).not.toBe("deal_announced");
  });

  it("classifies a 5.07 from the events dated before it, not the current deal set", async () => {
    await seedSpac(920);
    await seedIpo(920);
    await run8K(920, "920-da", "1.01,9.01", "2021-03-01", mergerTxt("2021-03-01"));
    await run8K(920, "920-close", "2.01", "2021-06-15");
    // Out-of-order arrival: the vote 8-K is processed last but dated between.
    await run8K(920, "920-vote", "5.07", "2021-06-01");

    const events = await repo.getEvents(920);
    expect(events.find((e) => e.accession_number === "920-vote")?.event_type).toBe("vote");
    expect((await repo.getSpac(920))?.vote_date).toBe("2021-06-01");
  });

  it("maps a post-completion annual-meeting 5.07 to eight_k", async () => {
    await seedSpac(930);
    await seedIpo(930);
    await run8K(930, "930-da", "1.01,9.01", "2021-03-01", mergerTxt("2021-03-01"));
    await run8K(930, "930-close", "2.01", "2021-06-15");
    await run8K(930, "930-annual", "5.07", "2022-05-01");

    const events = await repo.getEvents(930);
    expect(events.find((e) => e.accession_number === "930-annual")?.event_type).toBe("eight_k");
  });

  it("classifies a merger 1.01 as a DA for a SPAC with no recorded IPO date", async () => {
    // The AI content classifier mints known-SPAC rows for SIC-miscoded filers,
    // whose 424 never records an `ipo` event.
    await seedSpac(940); // registration only — no seedIpo
    await run8K(940, "940-da", "1.01,9.01", "2021-03-01", mergerTxt("2021-03-01"));

    const events = await repo.getEvents(940);
    expect(events.find((e) => e.accession_number === "940-da")?.event_type).toBe(
      "definitive_agreement"
    );
    expect((await repo.getSpac(940))?.definitive_agreement_date).toBe("2021-03-01");
  });
});
