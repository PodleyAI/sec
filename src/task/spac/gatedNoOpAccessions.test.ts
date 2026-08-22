/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import type { Filing } from "../../storage/filing/FilingSchema";
import { SpacMergerExtractionRepo } from "../../storage/spac/SpacMergerExtractionRepo";
import { SpacRedemptionExtractionRepo } from "../../storage/spac/SpacRedemptionExtractionRepo";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { loadGatedNoOpAccessions } from "./gatedNoOpAccessions";

const CIK = 1800001;

function filing(accession: string, form: string, items: string | null = null): Filing {
  return {
    cik: CIK,
    accession_number: accession,
    form,
    primary_doc: "doc.htm",
    file_number: "333-1",
    filing_date: "2022-03-01",
    acceptance_date: "2022-03-01T00:00:00.000Z",
    report_date: null,
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items,
    act: null,
  };
}

async function mintSpacRow(): Promise<void> {
  await new SpacReportWriter().recordRegistration({
    cik: CIK,
    accession_number: "reg",
    filing_date: "2021-01-04",
    form: "S-1",
    primary_document: "s1.htm",
    spac_name: "Gated SPAC",
    spac_sic: 6770,
  });
}

async function saveEvent(
  accession: string,
  event_type: "vote" | "unit_split" | "completed",
  event_date = "2022-03-01"
): Promise<void> {
  await new SpacRepo().saveEvent({
    cik: CIK,
    accession_number: accession,
    event_type,
    event_date,
    form: null,
    primary_document: null,
    source_document_url: null,
    deal_index: null,
    amount: null,
    shares: null,
    detail: null,
    confidence: null,
    created_at: new Date().toISOString(),
  });
}

describe("loadGatedNoOpAccessions", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("is empty when the issuer still has no spac row", async () => {
    // Replaying repairs nothing while the row the handlers gate on is absent,
    // so the ordinary already-succeeded skip must stand.
    const out = await loadGatedNoOpAccessions(CIK, [
      filing("0000000000-26-000001", "8-K", "5.07"),
      filing("0000000000-26-000002", "DEFM14A"),
      filing("0000000000-26-000003", "25-NSE"),
    ]);

    expect([...out]).toEqual([]);
  });

  it("never selects an 8-K carrying no item code a known-SPAC handler acts on", async () => {
    // A 2.02 earnings 8-K writes nothing whether or not the spac row exists.
    // Without this precondition every such filing would be replayed on every
    // sweep forever, undoing the already-succeeded skip entirely.
    await mintSpacRow();

    const out = await loadGatedNoOpAccessions(CIK, [filing("0000000000-26-000001", "8-K", "2.02")]);

    expect([...out]).toEqual([]);
  });

  it("does not select a trigger 8-K that already wrote an event", async () => {
    await mintSpacRow();
    await saveEvent("0000000000-26-000001", "vote");

    const out = await loadGatedNoOpAccessions(CIK, [filing("0000000000-26-000001", "8-K", "5.07")]);

    expect([...out]).toEqual([]);
  });

  it("does not select a trigger 8-K whose detector left a resolved MODEL_EMPTY entry", async () => {
    // A confident "no redemption reported" auto-resolves its dead letter rather
    // than deleting it, so the resolved row is the only durable evidence the
    // detector ran. Ignoring it re-pays that AI call on every sweep.
    await mintSpacRow();
    const deadLetters = new ExtractionDeadLetterRepo();
    await deadLetters.record({
      extractor_id: "redemption",
      accession_number: "0000000000-26-000001",
      section_name: "redemption",
      reason_code: "MODEL_EMPTY",
      detail: null,
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });
    await deadLetters.markResolved("redemption", "0000000000-26-000001", "redemption");

    const out = await loadGatedNoOpAccessions(CIK, [filing("0000000000-26-000001", "8-K", "5.07")]);

    expect([...out]).toEqual([]);
  });

  it("does not select a trigger 8-K that already wrote a redemption row", async () => {
    await mintSpacRow();
    await new SpacRedemptionExtractionRepo().save({
      accession_number: "0000000000-26-000001",
      cik: CIK,
      form: "8-K",
      filing_date: "2022-03-01",
      extractor_id: "redemption",
      extractor_version: "1.0.0",
      redemption_shares: 100,
      redemption_amount: 1000,
      price_per_share: 10,
      confidence: 0.9,
      source_span: null,
      model_id: null,
      created_at: new Date().toISOString(),
    });

    const out = await loadGatedNoOpAccessions(CIK, [filing("0000000000-26-000001", "8-K", "5.07")]);

    expect([...out]).toEqual([]);
  });

  it("selects a trigger 8-K with no event, no extraction row, and no dead letter", async () => {
    await mintSpacRow();

    const out = await loadGatedNoOpAccessions(CIK, [filing("0000000000-26-000001", "8-K", "5.07")]);

    expect([...out]).toEqual(["0000000000-26-000001"]);
  });

  it("selects a merger proxy with no extraction row, but not one that has it", async () => {
    await mintSpacRow();
    await new SpacMergerExtractionRepo().save({
      accession_number: "0000000000-26-000002",
      cik: CIK,
      form: "DEFM14A",
      filing_date: "2022-03-01",
      extractor_id: "merger-proxy",
      extractor_version: "1.0.0",
      target_name: "Acme",
      target_cik: null,
      target_observation_id: null,
      target_description: null,
      pipe_amount: null,
      equity_value: null,
      enterprise_value: null,
      merger_consideration: null,
      confidence: 0.9,
      source_span: null,
      seeks_combination_approval: null,
      model_id: null,
      created_at: new Date().toISOString(),
    });

    const out = await loadGatedNoOpAccessions(CIK, [
      filing("0000000000-26-000001", "DEFM14A"),
      filing("0000000000-26-000002", "DEFM14A"),
    ]);

    expect([...out]).toEqual(["0000000000-26-000001"]);
  });

  it("selects a 25-NSE with no event, but not one that already wrote one", async () => {
    await mintSpacRow();
    await saveEvent("0000000000-26-000002", "unit_split");

    const out = await loadGatedNoOpAccessions(CIK, [
      filing("0000000000-26-000001", "25-NSE"),
      filing("0000000000-26-000002", "25-NSE"),
    ]);

    expect([...out]).toEqual(["0000000000-26-000001"]);
  });

  it("never selects an annual 20-F that the classifier ignores", async () => {
    // 20-F routes to the 25-15 extractor so an FPI CLOSE filing can record its
    // combination. An ORDINARY annual report classifies `ignore` and
    // `processDeregistration` returns without writing — so an event-only test
    // re-selects it every single year, for the life of the issuer, and a
    // foreign private issuer files one annually forever.
    await mintSpacRow();

    const out = await loadGatedNoOpAccessions(CIK, [filing("0000000000-26-000001", "20-F")]);

    expect([...out]).toEqual([]);
  });

  it("never selects a post-completion 20-F", async () => {
    // Once a completion is on the stream, no later 20-F is the filing that
    // records it — the classifier says `ignore` on that ground alone.
    await mintSpacRow();
    await saveEvent("0000000000-26-000000", "completed", "2021-06-01");

    const out = await loadGatedNoOpAccessions(CIK, [filing("0000000000-26-000001", "20-F")]);

    expect([...out]).toEqual([]);
  });

  it("never selects a 5.03-only 8-K, whose narrative is never fetched", async () => {
    // 5.03 maps to an event only when the 8-K NARRATIVE names a new registrant,
    // and the narrative exists only for a fetch escalated to the full
    // submission — which happens for the redemption / LOI trigger items alone.
    // A 5.03-only 8-K therefore writes no event on any run and, having no full
    // submission text, runs neither detector, so it leaves no dead letter
    // either: nothing it can produce would ever deselect it.
    await mintSpacRow();

    const out = await loadGatedNoOpAccessions(CIK, [filing("0000000000-26-000001", "8-K", "5.03")]);

    expect([...out]).toEqual([]);
  });

  it("still selects a 5.03 8-K that also carries an LOI trigger", async () => {
    // The exclusion is of the STANDALONE code, not of the filing: 8.01
    // escalates the fetch, so this 8-K really can produce a detector answer.
    await mintSpacRow();

    const out = await loadGatedNoOpAccessions(CIK, [
      filing("0000000000-26-000001", "8-K", "5.03,8.01"),
    ]);

    expect([...out]).toEqual(["0000000000-26-000001"]);
  });

  it("never selects an optional-form proxy whose merger section was legitimately absent", async () => {
    // A `DEF 14A` is usually an annual or extension vote with no merger section
    // at all, and the processor writes no extraction row for one — by design.
    // The resolved SECTION_NOT_FOUND trace it records instead is the evidence
    // that it ran; without reading it, every general proxy of all 575 SPACs
    // that file one is replayed on every sweep, forever.
    await mintSpacRow();
    await new ExtractionDeadLetterRepo().recordResolved({
      extractor_id: "merger-proxy",
      accession_number: "0000000000-26-000001",
      section_name: "merger",
      reason_code: "SECTION_NOT_FOUND",
      detail: "no merger / business-combination / PIPE section text",
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });

    const out = await loadGatedNoOpAccessions(CIK, [filing("0000000000-26-000001", "DEF 14A")]);

    expect([...out]).toEqual([]);
  });

  it("still selects a merger proxy with neither an extraction row nor a dead-letter entry", async () => {
    // The gated no-op this branch exists for: nothing ran at all.
    await mintSpacRow();

    const out = await loadGatedNoOpAccessions(CIK, [filing("0000000000-26-000001", "DEF 14A")]);

    expect([...out]).toEqual(["0000000000-26-000001"]);
  });

  it("reads dead letters scoped to the issuer's accessions", async () => {
    // The detector lookup used to load every row of both extractors, memoized
    // only within one call — i.e. per CIK — so a batch over ~1,500 SPACs read
    // the whole table 1,500 times. Scoping it to the accessions on this
    // issuer's timeline is the fix, and an unrelated row must neither be read
    // nor answer for this issuer's filing.
    await mintSpacRow();
    const deadLetters = new ExtractionDeadLetterRepo();
    await deadLetters.recordResolved({
      extractor_id: "redemption",
      accession_number: "9999999999-26-999999",
      section_name: "redemption",
      reason_code: "MODEL_EMPTY",
      detail: null,
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });

    const storage = globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN);
    const spy = vi.spyOn(storage, "query");
    const out = await loadGatedNoOpAccessions(CIK, [filing("0000000000-26-000001", "8-K", "5.07")]);

    expect([...out]).toEqual(["0000000000-26-000001"]);
    expect(spy).toHaveBeenCalled();
    for (const [criteria] of spy.mock.calls) {
      expect(criteria).toHaveProperty("accession_number");
    }
  });

  it("never selects a filing whose extractor is not spac-row gated", async () => {
    await mintSpacRow();

    const out = await loadGatedNoOpAccessions(CIK, [
      filing("0000000000-26-000001", "S-1"),
      filing("0000000000-26-000002", "424B4"),
      filing("0000000000-26-000003", "D"),
    ]);

    expect([...out]).toEqual([]);
  });
});
