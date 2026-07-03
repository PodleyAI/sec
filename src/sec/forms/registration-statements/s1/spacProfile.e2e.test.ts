/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../../config/TestingDI";
import { setupAllDatabases } from "../../../../config/setupAllDatabases";
import { registerFakeStructuredProvider, fakeS1Model } from "./testing/fakeStructuredProvider";
import { processFormS1 } from "../Form_S_1.storage";
import { SpacRepo } from "../../../../storage/spac/SpacRepo";
import { ExtractionDeadLetterRepo } from "../../../../storage/dead-letter/ExtractionDeadLetterRepo";

// A SPAC prospectus body carrying a "PROSPECTUS SUMMARY" heading (so the profile
// section segments) plus the standard entity headings with placeholder bodies.
const SUMMARY_SENTENCE = "We intend to focus on financial technology businesses in Latin America.";
const BODY = [
  `<h1>PROSPECTUS SUMMARY</h1><p>${SUMMARY_SENTENCE}</p>`,
  "<h1>MANAGEMENT</h1><p>x</p>",
  "<h1>PRINCIPAL AND SELLING STOCKHOLDERS</h1><p>x</p>",
  "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1><p>x</p>",
].join("");

function parsed(sic: number | null) {
  return {
    header: {
      sic,
      sicDescription: sic === 6770 ? "BLANK CHECKS" : null,
      cik: null,
      companyName: "Example Acquisition Corp",
      filingDate: null,
    },
    html: BODY,
  };
}

function runArgs(cik: number, accession: string, sic: number | null) {
  return {
    cik,
    file_number: "333-1",
    accession_number: accession,
    filing_date: "2026-01-01",
    primary_doc: `${accession}.txt`,
    form: "S-1",
    formS1: parsed(sic) as never,
    model: fakeS1Model(),
  };
}

const PROFILE_PAYLOAD = {
  focus: ["FinTech", "Financial Services"],
  focus_location: ["Latin America"],
  description: "A blank-check company targeting fintech in Latin America.",
  team: "Led by experienced fintech operators.",
  url_spac: "https://example-spac.com",
  confidence: 0.9,
  source_span: "financial technology businesses in Latin America",
};

describe("SPAC profile end-to-end", () => {
  let unregister: (() => void) | undefined;
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    unregister?.();
    unregister = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("merges the AI profile (focus/description/team/url) onto the spac row", async () => {
    // Call order for a SPAC: profile, management, ownership, related, ...; the
    // profile section runs first so it consumes the first scripted payload.
    ({ unregister } = registerFakeStructuredProvider([
      PROFILE_PAYLOAD,
      { people: [] },
      { owners: [] },
      { parties: [] },
    ]));

    await processFormS1(runArgs(1848507, "0000000000-26-000901", 6770));

    const row = await new SpacRepo().getSpac(1848507);
    expect(row).toBeDefined();
    expect(row!.status).toBe("registered");
    expect(row!.spac_name).toBe("Example Acquisition Corp");
    expect(row!.focus).toBe(JSON.stringify(["FinTech", "Financial Services"]));
    expect(row!.focus_location).toBe(JSON.stringify(["Latin America"]));
    expect(row!.description).toBe("A blank-check company targeting fintech in Latin America.");
    expect(row!.team).toBe("Led by experienced fintech operators.");
    expect(row!.url_spac).toBe("https://example-spac.com");
    // Editorial-only columns stay null (no SEC writer).
    expect(row!.url_sponsor).toBeNull();
    expect(row!.details).toBeNull();
  });

  it("stores null (not '[]') for an empty focus so a later filing can't be clobbered", async () => {
    ({ unregister } = registerFakeStructuredProvider([
      {
        focus: [],
        focus_location: [],
        description: "A generalist blank-check company.",
        team: null,
        url_spac: null,
        confidence: 0.9,
        source_span: "financial technology businesses in Latin America",
      },
      { people: [] },
      { owners: [] },
      { parties: [] },
    ]));

    await processFormS1(runArgs(1848507, "0000000000-26-000904", 6770));

    const row = await new SpacRepo().getSpac(1848507);
    expect(row).toBeDefined();
    // Empty arrays must serialize to null (mirrors spac_tickers), so the
    // rollup's non-null-wins merge preserves any prior tags across filings.
    expect(row!.focus).toBeNull();
    expect(row!.focus_location).toBeNull();
    // Non-empty narrative still lands.
    expect(row!.description).toBe("A generalist blank-check company.");
  });

  it("dead-letters spac-profile when the summary heading is absent, row still created", async () => {
    ({ unregister } = registerFakeStructuredProvider([{ people: [] }]));
    // A body without a PROSPECTUS SUMMARY heading: profile section not found.
    const noSummary = {
      ...runArgs(222333, "0000000000-26-000902", 6770),
      formS1: {
        header: {
          sic: 6770,
          sicDescription: "BLANK CHECKS",
          cik: null,
          companyName: "No Summary Corp",
          filingDate: null,
        },
        html: "<h1>MANAGEMENT</h1><p>x</p>",
      } as never,
    };
    await processFormS1(noSummary);

    const row = await new SpacRepo().getSpac(222333);
    expect(row).toBeDefined();
    expect(row!.spac_name).toBe("No Summary Corp");
    expect(row!.focus).toBeNull();

    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    const profileDl = dl.find(
      (d) => d.section_name === "spac-profile" && d.accession_number === "0000000000-26-000902"
    );
    expect(profileDl?.reason_code).toBe("SECTION_NOT_FOUND");
  });

  it("does not run the profile section for a non-SPAC S-1", async () => {
    ({ unregister } = registerFakeStructuredProvider([{ people: [] }]));
    await processFormS1(runArgs(444555, "0000000000-26-000903", 3571));

    // Non-SPAC: no spac row at all, and no spac-profile dead-letter.
    const row = await new SpacRepo().getSpac(444555);
    expect(row).toBeUndefined();
    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    expect(dl.some((d) => d.section_name === "spac-profile")).toBe(false);
  });
});
