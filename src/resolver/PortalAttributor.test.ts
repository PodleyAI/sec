/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { AccreditedPortalSignalRepo } from "../storage/accredited-portal/AccreditedPortalSignalRepo";
import { FormDPortalAttributionRepo } from "../storage/accredited-portal/FormDPortalAttributionRepo";
import type { AccreditedPortalSignalType } from "../storage/accredited-portal/AccreditedPortalSignalSchema";
import { PortalAttributor } from "./PortalAttributor";

async function seedSignal(
  signal_type: AccreditedPortalSignalType,
  signal_value: string,
  portal_id: string
): Promise<void> {
  await new AccreditedPortalSignalRepo().saveSignal({
    signal_type,
    signal_value,
    portal_id,
    source: "manual",
    note: null,
    created_at: new Date().toISOString(),
  });
}

describe("PortalAttributor", () => {
  let attributionRepo: FormDPortalAttributionRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    attributionRepo = new FormDPortalAttributionRepo();
  });

  it("writes one row per matched portal with the strongest signal", async () => {
    await seedSignal("name", "angellist advisors", "angellist");
    await seedSignal("address", "90 gold st|san francisco|ca|us|94102", "angellist");

    const written = await new PortalAttributor().attribute({
      accession_number: "0000000001-26-000001",
      cik: 12345,
      filing_date: "2026-01-15",
      candidates: [
        { signal_type: "name", signal_value: "angellist advisors", via: "form-d:related-person" },
        {
          signal_type: "address",
          signal_value: "90 gold st|san francisco|ca|us|94102",
          via: "form-d:primary-issuer",
        },
        { signal_type: "name", signal_value: "unrelated fund", via: "form-d:primary-issuer" },
      ],
    });

    expect(written.length).toBe(1);
    const row = await attributionRepo.getAttribution("0000000001-26-000001", "angellist");
    expect(row?.matched_signal_type).toBe("address");
    expect(row?.cik).toBe(12345);
    expect(row?.filing_date).toBe("2026-01-15");
    expect(JSON.parse(row!.matches).length).toBe(2);
  });

  it("attributes one filing to multiple portals when signals for both hit", async () => {
    await seedSignal("name", "angellist advisors", "angellist");
    await seedSignal("phone", "+1 415-555-0100", "forge-global");

    const written = await new PortalAttributor().attribute({
      accession_number: "0000000001-26-000002",
      cik: null,
      filing_date: null,
      candidates: [
        { signal_type: "name", signal_value: "angellist advisors", via: "form-d:related-person" },
        { signal_type: "phone", signal_value: "+1 415-555-0100", via: "form-d:primary-issuer" },
      ],
    });
    expect(written.map((w) => w.portal_id).sort()).toEqual(["angellist", "forge-global"]);
  });

  it("deduplicates repeated candidates and skips empty values", async () => {
    await seedSignal("name", "percent", "percent");
    const written = await new PortalAttributor().attribute({
      accession_number: "0000000001-26-000003",
      cik: null,
      filing_date: null,
      candidates: [
        { signal_type: "name", signal_value: "percent", via: "form-d:primary-issuer" },
        { signal_type: "name", signal_value: "percent", via: "form-d:related-person" },
        { signal_type: "name", signal_value: "", via: "form-d:related-person" },
      ],
    });
    expect(written.length).toBe(1);
    expect(JSON.parse(written[0].matches).length).toBe(1);
  });

  it("writes nothing when no candidate matches", async () => {
    const written = await new PortalAttributor().attribute({
      accession_number: "0000000001-26-000004",
      cik: null,
      filing_date: null,
      candidates: [{ signal_type: "name", signal_value: "no such portal", via: "form-d:issuer" }],
    });
    expect(written.length).toBe(0);
    expect((await attributionRepo.listByAccession("0000000001-26-000004")).length).toBe(0);
  });

  it("restricts writes to the scoped portal when configured", async () => {
    await seedSignal("name", "angellist advisors", "angellist");
    await seedSignal("phone", "+1 415-555-0100", "forge-global");

    const written = await new PortalAttributor({ scopePortalId: "forge-global" }).attribute({
      accession_number: "0000000001-26-000005",
      cik: null,
      filing_date: null,
      candidates: [
        { signal_type: "name", signal_value: "angellist advisors", via: "form-d:related-person" },
        { signal_type: "phone", signal_value: "+1 415-555-0100", via: "form-d:primary-issuer" },
      ],
    });
    expect(written.map((w) => w.portal_id)).toEqual(["forge-global"]);
    expect(
      await attributionRepo.getAttribution("0000000001-26-000005", "angellist")
    ).toBeUndefined();
  });

  it("re-attribution overwrites the row in place", async () => {
    await seedSignal("name", "percent", "percent");
    const input = {
      accession_number: "0000000001-26-000006",
      cik: 999,
      filing_date: "2026-02-01",
      candidates: [
        { signal_type: "name" as const, signal_value: "percent", via: "form-d:primary-issuer" },
      ],
    };
    await new PortalAttributor().attribute(input);
    await new PortalAttributor().attribute(input);
    expect((await attributionRepo.listByAccession("0000000001-26-000006")).length).toBe(1);
  });
});
