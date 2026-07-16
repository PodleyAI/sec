/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { AccreditedPortalSignalRepo } from "./AccreditedPortalSignalRepo";
import {
  normalizeAddressSignal,
  normalizeNameSignal,
  normalizePhoneSignal,
} from "./SignalNormalization";
import { normalizeAddress } from "../address/AddressNormalization";
import { normalizeCompanyName } from "../company/CompanyNormalization";
import { normalizePhone } from "../phone/PhoneNormalization";

describe("SignalNormalization", () => {
  it("normalizes names with the company normalizer, lower-cased", () => {
    expect(normalizeNameSignal("AngelList Advisors, LLC")).toBe("angellist advisors llc");
    expect(normalizeNameSignal("Forge Global, Inc.")).toBe("forge global");
    expect(normalizeNameSignal("  Forge Global ")).toBe("forge global");
    expect(normalizeNameSignal("")).toBeNull();
    expect(normalizeNameSignal("ab")).toBeNull();
  });

  it("rejects placeholder tokens so no producer path emits them as name signals", () => {
    expect(normalizeNameSignal("None")).toBeNull();
    expect(normalizeNameSignal("N/A")).toBeNull();
    expect(normalizeNameSignal("same")).toBeNull();
    expect(normalizeNameSignal("[related person is an entity]")).toBeNull();
  });

  it("is stable when re-applied to an already-normalized name (ingest vs backfill parity)", () => {
    // The backfill feeds stored normalized_name (= normalizeCompanyName(raw))
    // back through normalizeNameSignal, while ingest normalizes the raw name
    // once. Exact-string matching requires f(normalize(raw)) === f(raw).
    const names = [
      "AngelList Advisors, LLC",
      "Forge Global, Inc.",
      "International Business Machines Corp",
      "apple",
      "Nasdaq Private Market LLC",
      "X Y Z Inc Ltd Co",
    ];
    for (const raw of names) {
      const once = normalizeNameSignal(raw);
      const stored = normalizeCompanyName(raw);
      expect(normalizeNameSignal(stored)).toBe(once);
    }
  });

  it("produces the same phone key as the ingest path", () => {
    const viaIngest = normalizePhone({ phone_raw: "(415) 555-0100", country_code: "US" });
    expect(normalizePhoneSignal("(415) 555-0100")).toBe(viaIngest?.international_number);
    expect(normalizePhoneSignal("not a phone")).toBeNull();
  });

  it("produces the same address key as the ingest path", () => {
    const address = {
      street1: "228 Park Ave S",
      city: "New York",
      stateOrCountry: "NY",
      zipCode: "10003",
    };
    const viaIngest = normalizeAddress(address);
    expect(normalizeAddressSignal(address)).toBe(viaIngest?.address_hash_id);
    expect(normalizeAddressSignal({ street1: null, city: null })).toBeNull();
  });
});

describe("AccreditedPortalSignalRepo", () => {
  let repo: AccreditedPortalSignalRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = new AccreditedPortalSignalRepo();
  });

  it("keys signals by (type, value) and re-points on re-add", async () => {
    await repo.saveSignal({
      signal_type: "name",
      signal_value: "angellist",
      portal_id: "angellist",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });
    await repo.saveSignal({
      signal_type: "name",
      signal_value: "angellist",
      portal_id: "other-portal",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });
    const signal = await repo.getSignal("name", "angellist");
    expect(signal?.portal_id).toBe("other-portal");
    expect((await repo.getAllSignals()).length).toBe(1);
  });

  it("upsertSeedSignal never overwrites a manual signal", async () => {
    await repo.saveSignal({
      signal_type: "name",
      signal_value: "republic",
      portal_id: "some-other-portal",
      source: "manual",
      note: "curator re-pointed",
      created_at: new Date().toISOString(),
    });
    const wrote = await repo.upsertSeedSignal({
      signal_type: "name",
      signal_value: "republic",
      portal_id: "republic",
      note: null,
    });
    expect(wrote).toBe(false);
    expect((await repo.getSignal("name", "republic"))?.portal_id).toBe("some-other-portal");
  });

  it("upsertSeedSignal refreshes seed signals and lists by portal", async () => {
    expect(
      await repo.upsertSeedSignal({
        signal_type: "name",
        signal_value: "percent",
        portal_id: "percent",
        note: null,
      })
    ).toBe(true);
    expect(
      await repo.upsertSeedSignal({
        signal_type: "name",
        signal_value: "percent",
        portal_id: "percent",
        note: null,
      })
    ).toBe(true);
    expect((await repo.listByPortal("percent")).length).toBe(1);

    await repo.removeSignal("name", "percent");
    expect(await repo.getSignal("name", "percent")).toBeUndefined();
  });
});
