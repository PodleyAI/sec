/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Accredited-portal attribution through the Form D ingest path: seed a portal
 * fingerprint matching a fixture's issuer address/phone/name, run
 * processFormD, and assert the attribution row.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { AccreditedPortalSignalRepo } from "../../../storage/accredited-portal/AccreditedPortalSignalRepo";
import { FormDPortalAttributionRepo } from "../../../storage/accredited-portal/FormDPortalAttributionRepo";
import {
  normalizeAddressSignal,
  normalizeNameSignal,
  normalizePhoneSignal,
} from "../../../storage/accredited-portal/SignalNormalization";
import { Form_D } from "./Form_D";
import { processFormD } from "./Form_D.storage";
import type { FormD } from "./Form_D.schema";
import {
  accessionFromFixtureName,
  deriveFileNumber,
  listFixtureFiles,
  readFixture,
  safeCikToInt,
} from "./pipeline-test-util";

const FIXTURE_SLUG = "form-d";

describe("Form_D accredited-portal attribution", () => {
  let signalRepo: AccreditedPortalSignalRepo;
  let attributionRepo: FormDPortalAttributionRepo;
  let fixtureFile: string;
  let formD: FormD;
  let accession: string;
  let cik: number;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    signalRepo = new AccreditedPortalSignalRepo();
    attributionRepo = new FormDPortalAttributionRepo();

    fixtureFile = listFixtureFiles(FIXTURE_SLUG)[0];
    formD = await Form_D.parse("D", readFixture(FIXTURE_SLUG, fixtureFile));
    accession = accessionFromFixtureName(fixtureFile);
    cik = safeCikToInt(formD.primaryIssuer.cik);
  });

  async function ingest(): Promise<void> {
    await processFormD({
      cik,
      file_number: deriveFileNumber(accession),
      accession_number: accession,
      filing_date: "2026-01-15",
      primary_doc: fixtureFile,
      formD,
    });
  }

  it("attributes via the issuer address, preferring it over a name match", async () => {
    const addressSignal = normalizeAddressSignal(formD.primaryIssuer.issuerAddress);
    expect(addressSignal).toBeTruthy();
    const nameSignal = normalizeNameSignal(formD.primaryIssuer.entityName);
    expect(nameSignal).toBeTruthy();

    await signalRepo.saveSignal({
      signal_type: "address",
      signal_value: addressSignal!,
      portal_id: "test-portal",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });
    await signalRepo.saveSignal({
      signal_type: "name",
      signal_value: nameSignal!,
      portal_id: "test-portal",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });

    await ingest();

    const row = await attributionRepo.getAttribution(accession, "test-portal");
    expect(row).toBeDefined();
    expect(row?.matched_signal_type).toBe("address");
    expect(row?.matched_signal_value).toBe(addressSignal);
    expect(row?.cik).toBe(cik);
    expect(row?.filing_date).toBe("2026-01-15");
    const matches = JSON.parse(row!.matches) as Array<{ via: string }>;
    expect(matches.some((m) => m.via === "form-d:primary-issuer")).toBe(true);
  });

  it("attributes via the issuer phone number", async () => {
    const phoneSignal = normalizePhoneSignal(formD.primaryIssuer.issuerPhoneNumber);
    expect(phoneSignal).toBeTruthy();

    await signalRepo.saveSignal({
      signal_type: "phone",
      signal_value: phoneSignal!,
      portal_id: "test-portal",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });

    await ingest();

    const row = await attributionRepo.getAttribution(accession, "test-portal");
    expect(row?.matched_signal_type).toBe("phone");
  });

  it("writes no attribution when no signal matches", async () => {
    await signalRepo.saveSignal({
      signal_type: "name",
      signal_value: "portal that never appears",
      portal_id: "test-portal",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });

    await ingest();

    expect((await attributionRepo.listByAccession(accession)).length).toBe(0);
  });
});
