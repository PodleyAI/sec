/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { AccreditedPortalSignalRepo } from "../storage/accredited-portal/AccreditedPortalSignalRepo";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { suggestPortalSignals } from "./suggestPortalSignals";

const SHARED_ADDRESS = "90 gold st|san francisco|ca|us|94102";
const RARE_ADDRESS = "1 lonely rd|nowhere|mt|us|59001";

async function seedObservation(
  accession: string,
  index: number,
  name: string,
  address: string
): Promise<void> {
  await new CompanyObservationRepo().upsertByNaturalKey({
    accession_number: accession,
    extractor_id: "D",
    extractor_version: "1.0.0",
    observation_index: index,
    name,
    raw_address_id: address,
    source_context: JSON.stringify({ relation: "form-d:primary-issuer" }),
    created_at: new Date().toISOString(),
  });
}

describe("suggestPortalSignals", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    for (let i = 0; i < 4; i++) {
      await seedObservation(`0000000001-26-00010${i}`, 0, `SPV Fund ${i} LLC`, SHARED_ADDRESS);
    }
    // Duplicate mention within one filing must not inflate the filing count.
    await seedObservation("0000000001-26-000100", 1, "SPV Fund 0 Manager LLC", SHARED_ADDRESS);
    await seedObservation("0000000001-26-000200", 0, "Solo Fund LLC", RARE_ADDRESS);
  });

  it("surfaces addresses shared across many filings with distinct-accession counts", async () => {
    const suggestions = await suggestPortalSignals({ minFilings: 3 });
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].signal_type).toBe("address");
    expect(suggestions[0].signal_value).toBe(SHARED_ADDRESS);
    expect(suggestions[0].filings).toBe(4);
    expect(suggestions[0].sample_names.length).toBeGreaterThan(0);
  });

  it("excludes values already curated as signals", async () => {
    await new AccreditedPortalSignalRepo().saveSignal({
      signal_type: "address",
      signal_value: SHARED_ADDRESS,
      portal_id: "angellist",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });
    const suggestions = await suggestPortalSignals({ minFilings: 3 });
    expect(suggestions.length).toBe(0);
  });

  it("respects minFilings for rarely-shared values", async () => {
    const suggestions = await suggestPortalSignals({ minFilings: 1 });
    expect(suggestions.map((s) => s.signal_value)).toContain(RARE_ADDRESS);
  });
});
