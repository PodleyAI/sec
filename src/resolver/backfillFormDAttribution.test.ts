/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { AccreditedPortalSignalRepo } from "../storage/accredited-portal/AccreditedPortalSignalRepo";
import { FormDPortalAttributionRepo } from "../storage/accredited-portal/FormDPortalAttributionRepo";
import { backfillFormDAttribution } from "./backfillFormDAttribution";

const ACCESSION = "0000000001-26-000100";
const ADDRESS_ID = "90 gold st|san francisco|ca|us|94102";

describe("backfillFormDAttribution", () => {
  let signalRepo: AccreditedPortalSignalRepo;
  let attributionRepo: FormDPortalAttributionRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    signalRepo = new AccreditedPortalSignalRepo();
    attributionRepo = new FormDPortalAttributionRepo();

    await new CompanyObservationRepo().upsertByNaturalKey({
      accession_number: ACCESSION,
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      name: "Some SPV Fund I LLC",
      normalized_name: "Some SPV Fund I",
      raw_address_id: ADDRESS_ID,
      source_context: JSON.stringify({ relation: "form-d:primary-issuer" }),
      created_at: new Date().toISOString(),
    });
    // middle_name is a bad-data placeholder; the backfill must drop it the
    // same way the ingest path does or the reconstructed name signal differs.
    await new PersonObservationRepo().upsertByNaturalKey({
      accession_number: ACCESSION,
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 200,
      middle_name: "None",
      last_name: "AngelList Advisors",
      source_context: JSON.stringify({ relation: "form-d:related-person" }),
      created_at: new Date().toISOString(),
    });
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
      cik: 12345,
      accession_number: ACCESSION,
      filing_date: "2026-01-15",
      report_date: null,
      acceptance_date: "2026-01-15T10:00:00.000Z",
      form: "D",
      file_number: null,
      film_number: null,
      primary_doc: "primary_doc.xml",
      primary_doc_description: null,
      size: null,
      is_xbrl: null,
      is_inline_xbrl: null,
      items: null,
      act: null,
    });
  });

  it("recomputes attributions from stored observations", async () => {
    await signalRepo.saveSignal({
      signal_type: "address",
      signal_value: ADDRESS_ID,
      portal_id: "angellist",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });

    const result = await backfillFormDAttribution({});
    expect(result.filings).toBe(1);
    expect(result.attributions).toBe(1);

    const row = await attributionRepo.getAttribution(ACCESSION, "angellist");
    expect(row?.matched_signal_type).toBe("address");
    expect(row?.cik).toBe(12345);
    expect(row?.filing_date).toBe("2026-01-15");
  });

  it("matches person-observation names against name signals", async () => {
    await signalRepo.saveSignal({
      signal_type: "name",
      signal_value: "angellist advisors",
      portal_id: "angellist",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });

    const result = await backfillFormDAttribution({});
    expect(result.attributions).toBe(1);
    const row = await attributionRepo.getAttribution(ACCESSION, "angellist");
    expect(row?.matched_signal_type).toBe("name");
  });

  it("clear-then-recompute drops attributions whose signal was removed", async () => {
    await signalRepo.saveSignal({
      signal_type: "address",
      signal_value: ADDRESS_ID,
      portal_id: "angellist",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });
    await backfillFormDAttribution({});
    expect((await attributionRepo.listByPortal("angellist")).length).toBe(1);

    await signalRepo.removeSignal("address", ADDRESS_ID);
    const result = await backfillFormDAttribution({});
    expect(result.attributions).toBe(0);
    expect((await attributionRepo.listByPortal("angellist")).length).toBe(0);
  });

  it("scoped recompute only clears and writes the requested portal", async () => {
    await signalRepo.saveSignal({
      signal_type: "address",
      signal_value: ADDRESS_ID,
      portal_id: "angellist",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });
    await signalRepo.saveSignal({
      signal_type: "name",
      signal_value: "angellist advisors",
      portal_id: "forge-global",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });
    await backfillFormDAttribution({});
    expect((await attributionRepo.listByAccession(ACCESSION)).length).toBe(2);

    // Re-point the forge signal and recompute only that portal: the angellist
    // row must survive untouched.
    await signalRepo.removeSignal("name", "angellist advisors");
    const result = await backfillFormDAttribution({ portalId: "forge-global" });
    expect(result.cleared).toBe(1);
    expect(await attributionRepo.getAttribution(ACCESSION, "forge-global")).toBeUndefined();
    expect(await attributionRepo.getAttribution(ACCESSION, "angellist")).toBeDefined();
  });
});
