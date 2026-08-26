/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import type {
  CanonicalCompanyAddress,
  CanonicalCompanyPhone,
  CanonicalPersonAddress,
  CanonicalPersonPhone,
} from "../storage/canonical/CanonicalJunctionSchemas";
import {
  CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN,
  CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN,
  CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
  CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN,
} from "../storage/canonical/CanonicalJunctionSchemas";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { buildEntityObserver } from "./buildEntityObserver";
import { rebuildCompanyJunctions, rebuildPersonJunctions } from "./rebuildJunctions";

const RESOLVER_VERSION = "1.0.0";

async function seedFiling(
  accession_number: string,
  cik: number,
  filing_date: string
): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik,
    accession_number,
    filing_date,
    acceptance_date: `${filing_date}T00:00:00.000Z`,
    report_date: null,
    form: "D",
    file_number: null,
    film_number: null,
    primary_doc: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  });
}

function personAddressKey(
  row: Pick<CanonicalPersonAddress, "canonical_person_id" | "address_hash_id">
): string {
  return `${row.canonical_person_id}\x00${row.address_hash_id}`;
}

function personPhoneKey(
  row: Pick<CanonicalPersonPhone, "canonical_person_id" | "international_number">
): string {
  return `${row.canonical_person_id}\x00${row.international_number}`;
}

function companyAddressKey(
  row: Pick<CanonicalCompanyAddress, "canonical_company_id" | "address_hash_id">
): string {
  return `${row.canonical_company_id}\x00${row.address_hash_id}`;
}

function companyPhoneKey(
  row: Pick<CanonicalCompanyPhone, "canonical_company_id" | "international_number">
): string {
  return `${row.canonical_company_id}\x00${row.international_number}`;
}

function byKey<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T> {
  return new Map(rows.map((row) => [keyOf(row), row]));
}

describe("rebuildPersonJunctions", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("matches the incrementally maintained address/phone junctions on keys and observation_count, including a re-observation with a changed address", async () => {
    // Four filings; ACC-3 is a second, later filing by the SAME person (Alpha)
    // sharing Beta's address, and ACC-4 is re-extracted once (same natural
    // key) with a different address and phone the second time.
    await seedFiling("ACC-1", 9000, "2024-01-10");
    await seedFiling("ACC-2", 9000, "2024-02-15");
    await seedFiling("ACC-3", 9000, "2024-03-20");
    await seedFiling("ACC-4", 9000, "2024-04-01");

    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });

    const alpha = await observer.observePerson({
      accession_number: "ACC-1",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 2001,
      last_name: "Alpha",
      address_id: "addr-shared",
      international_number: "+1-555-0001",
    });
    const beta = await observer.observePerson({
      accession_number: "ACC-2",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 2002,
      last_name: "Beta",
      address_id: "addr-shared",
    });
    // Alpha again, via a second filing (same cik => same canonical person),
    // sharing the same address and phone — this is the co-occurrence count
    // going to 2 rather than two separate rows.
    await observer.observePerson({
      accession_number: "ACC-3",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 2001,
      last_name: "Alpha",
      address_id: "addr-shared",
      international_number: "+1-555-0001",
    });
    await observer.observePerson({
      accession_number: "ACC-4",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 2003,
      last_name: "Gamma",
      address_id: "addr-gamma-original",
      international_number: "+1-555-0300",
    });
    // Re-observation of the SAME natural key (ACC-4, D, 0) with a CHANGED
    // address and phone — the case `removePriorPersonJunctions` exists for.
    const gamma = await observer.observePerson({
      accession_number: "ACC-4",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 2003,
      last_name: "Gamma",
      address_id: "addr-gamma-changed",
      international_number: "+1-555-0400",
    });

    const addressStorage = globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN);
    const phoneStorage = globalServiceRegistry.get(CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN);

    const addressSnapshot = (await addressStorage.getAll()) ?? [];
    const phoneSnapshot = (await phoneStorage.getAll()) ?? [];

    // Sanity on the incremental path itself: the changed-address
    // re-observation must leave no trace of the original address/phone —
    // proof `removePriorPersonJunctions` actually ran.
    expect(addressSnapshot.some((r) => r.address_hash_id === "addr-gamma-original")).toBe(false);
    expect(phoneSnapshot.some((r) => r.international_number === "+1-555-0300")).toBe(false);
    expect(addressSnapshot).toHaveLength(3);
    expect(phoneSnapshot).toHaveLength(2);

    const result = await rebuildPersonJunctions(RESOLVER_VERSION);

    expect(result.addressRows).toBe(3);
    expect(result.phoneRows).toBe(2);

    const rebuiltAddresses = (await addressStorage.getAll()) ?? [];
    const rebuiltPhones = (await phoneStorage.getAll()) ?? [];

    // Keys match exactly — same members, neither more nor fewer.
    expect(new Set(rebuiltAddresses.map(personAddressKey))).toEqual(
      new Set(addressSnapshot.map(personAddressKey))
    );
    expect(new Set(rebuiltPhones.map(personPhoneKey))).toEqual(
      new Set(phoneSnapshot.map(personPhoneKey))
    );

    // observation_count matches exactly per key.
    const snapshotAddrByKey = byKey(addressSnapshot, personAddressKey);
    const rebuiltAddrByKey = byKey(rebuiltAddresses, personAddressKey);
    for (const [key, snap] of snapshotAddrByKey) {
      expect(rebuiltAddrByKey.get(key)?.observation_count).toBe(snap.observation_count);
    }
    const snapshotPhoneByKey = byKey(phoneSnapshot, personPhoneKey);
    const rebuiltPhoneByKey = byKey(rebuiltPhones, personPhoneKey);
    for (const [key, snap] of snapshotPhoneByKey) {
      expect(rebuiltPhoneByKey.get(key)?.observation_count).toBe(snap.observation_count);
    }

    // Timestamps are the one intended difference: assert their NEW meaning
    // (the asserting filings' dates) rather than skipping them.
    const alphaAddr = rebuiltAddrByKey.get(
      personAddressKey({
        canonical_person_id: alpha.canonical_person_id,
        address_hash_id: "addr-shared",
      })
    )!;
    expect(alphaAddr.first_seen_at).toBe("2024-01-10"); // ACC-1, the earliest
    expect(alphaAddr.last_seen_at).toBe("2024-03-20"); // ACC-3, the latest
    expect(alphaAddr.observation_count).toBe(2);

    const betaAddr = rebuiltAddrByKey.get(
      personAddressKey({
        canonical_person_id: beta.canonical_person_id,
        address_hash_id: "addr-shared",
      })
    )!;
    expect(betaAddr.first_seen_at).toBe("2024-02-15");
    expect(betaAddr.last_seen_at).toBe("2024-02-15");
    expect(betaAddr.observation_count).toBe(1);

    const gammaAddr = rebuiltAddrByKey.get(
      personAddressKey({
        canonical_person_id: gamma.canonical_person_id,
        address_hash_id: "addr-gamma-changed",
      })
    )!;
    expect(gammaAddr.first_seen_at).toBe("2024-04-01");
    expect(gammaAddr.last_seen_at).toBe("2024-04-01");
    expect(gammaAddr.observation_count).toBe(1);

    const alphaPhone = rebuiltPhoneByKey.get(
      personPhoneKey({
        canonical_person_id: alpha.canonical_person_id,
        international_number: "+1-555-0001",
      })
    )!;
    expect(alphaPhone.first_seen_at).toBe("2024-01-10");
    expect(alphaPhone.last_seen_at).toBe("2024-03-20");
    expect(alphaPhone.observation_count).toBe(2);

    const gammaPhone = rebuiltPhoneByKey.get(
      personPhoneKey({
        canonical_person_id: gamma.canonical_person_id,
        international_number: "+1-555-0400",
      })
    )!;
    expect(gammaPhone.first_seen_at).toBe("2024-04-01");
    expect(gammaPhone.last_seen_at).toBe("2024-04-01");

    // The incremental path's timestamps are wall-clock instants written at
    // observation time, not the filing-derived dates the rebuild computes.
    const snapAlphaAddr = snapshotAddrByKey.get(
      personAddressKey({
        canonical_person_id: alpha.canonical_person_id,
        address_hash_id: "addr-shared",
      })
    )!;
    expect(snapAlphaAddr.first_seen_at).not.toBe(alphaAddr.first_seen_at);
    expect(snapAlphaAddr.first_seen_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is idempotent: a second rebuild with no new observations replaces rather than merges", async () => {
    await seedFiling("ACC-10", 9000, "2024-05-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    await observer.observePerson({
      accession_number: "ACC-10",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 3001,
      last_name: "Solo",
      address_id: "addr-solo",
      international_number: "+1-555-1000",
    });

    const first = await rebuildPersonJunctions(RESOLVER_VERSION);
    const second = await rebuildPersonJunctions(RESOLVER_VERSION);

    expect(second).toEqual(first);
    const addressStorage = globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN);
    expect(await addressStorage.getAll()).toHaveLength(1);
  });
});

describe("rebuildCompanyJunctions", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("matches the incrementally maintained company junctions on keys and observation_count, including a re-observation with a changed address", async () => {
    await seedFiling("CACC-1", 8000, "2024-06-01");
    await seedFiling("CACC-2", 8000, "2024-06-15");
    await seedFiling("CACC-3", 8000, "2024-07-01");

    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });

    const acme = await observer.observeCompany({
      accession_number: "CACC-1",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 5001,
      name: "Acme Corp",
      address_id: "addr-hq",
      international_number: "+1-555-2000",
    });
    // Re-observation of the SAME natural key with a changed address/phone —
    // the company-side mirror of `removePriorCompanyJunctions`.
    const acmeAgain = await observer.observeCompany({
      accession_number: "CACC-1",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 5001,
      name: "Acme Corp",
      address_id: "addr-hq-new",
      international_number: "+1-555-2001",
    });
    expect(acmeAgain.observation_id).toBe(acme.observation_id);

    const beta = await observer.observeCompany({
      accession_number: "CACC-2",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 5002,
      name: "Beta LLC",
      address_id: "addr-hq-new",
    });
    // Acme, via a second filing (same cik => same canonical company).
    await observer.observeCompany({
      accession_number: "CACC-3",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 5001,
      name: "Acme Corp",
      address_id: "addr-hq-new",
      international_number: "+1-555-2001",
    });

    const addressStorage = globalServiceRegistry.get(CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN);
    const phoneStorage = globalServiceRegistry.get(CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN);
    const addressSnapshot = (await addressStorage.getAll()) ?? [];
    const phoneSnapshot = (await phoneStorage.getAll()) ?? [];

    expect(addressSnapshot.some((r) => r.address_hash_id === "addr-hq")).toBe(false);
    expect(phoneSnapshot.some((r) => r.international_number === "+1-555-2000")).toBe(false);

    const result = await rebuildCompanyJunctions(RESOLVER_VERSION);

    const rebuiltAddresses = (await addressStorage.getAll()) ?? [];
    const rebuiltPhones = (await phoneStorage.getAll()) ?? [];

    expect(new Set(rebuiltAddresses.map(companyAddressKey))).toEqual(
      new Set(addressSnapshot.map(companyAddressKey))
    );
    expect(new Set(rebuiltPhones.map(companyPhoneKey))).toEqual(
      new Set(phoneSnapshot.map(companyPhoneKey))
    );

    const snapshotAddrByKey = byKey(addressSnapshot, companyAddressKey);
    const rebuiltAddrByKey = byKey(rebuiltAddresses, companyAddressKey);
    for (const [key, snap] of snapshotAddrByKey) {
      expect(rebuiltAddrByKey.get(key)?.observation_count).toBe(snap.observation_count);
    }
    expect(result.addressRows).toBe(addressSnapshot.length);
    expect(result.phoneRows).toBe(phoneSnapshot.length);

    const acmeAddr = rebuiltAddrByKey.get(
      companyAddressKey({
        canonical_company_id: acme.canonical_company_id,
        address_hash_id: "addr-hq-new",
      })
    )!;
    expect(acmeAddr.observation_count).toBe(2); // CACC-1 (post-change) + CACC-3
    expect(acmeAddr.first_seen_at).toBe("2024-06-01");
    expect(acmeAddr.last_seen_at).toBe("2024-07-01");

    const betaAddr = rebuiltAddrByKey.get(
      companyAddressKey({
        canonical_company_id: beta.canonical_company_id,
        address_hash_id: "addr-hq-new",
      })
    )!;
    expect(betaAddr.observation_count).toBe(1);
    expect(betaAddr.first_seen_at).toBe("2024-06-15");
  });
});
