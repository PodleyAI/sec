/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { CanonicalCompanyAddressRepo } from "../storage/canonical/CanonicalCompanyAddressRepo";
import { CanonicalCompanyPhoneRepo } from "../storage/canonical/CanonicalCompanyPhoneRepo";
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
import { CanonicalPersonAddressRepo } from "../storage/canonical/CanonicalPersonAddressRepo";
import { CanonicalPersonPhoneRepo } from "../storage/canonical/CanonicalPersonPhoneRepo";
import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { buildEntityObserver } from "./buildEntityObserver";
import { rebuildCompanyJunctions, rebuildPersonJunctions } from "./rebuildJunctions";

const RESOLVER_VERSION = "1.0.0";

/**
 * A generation `dropPrevious` would retire — rows written at it must survive a
 * rebuild of the active version untouched.
 */
const PREVIOUS_RESOLVER_VERSION = "0.9.0";

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

  it("matches the incrementally maintained address/phone junctions on keys and observation_count, including a re-observation with a changed address and a person with two distinct addresses", async () => {
    // ACC-3 is a second, later filing by the SAME person (Alpha) sharing
    // Beta's address; ACC-4 is re-extracted once (same natural key) with a
    // different address and phone the second time; ACC-5/ACC-6 are two
    // DIFFERENT filings by the same person (Delta) with two DIFFERENT
    // addresses and phones, proving the grouping key is sensitive to the
    // address/phone half, not just the canonical id.
    await seedFiling("ACC-1", 9000, "2024-01-10");
    await seedFiling("ACC-2", 9000, "2024-02-15");
    await seedFiling("ACC-3", 9000, "2024-03-20");
    await seedFiling("ACC-4", 9000, "2024-04-01");
    await seedFiling("ACC-5", 9000, "2024-05-05");
    await seedFiling("ACC-6", 9000, "2024-05-20");

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
    // Delta, via two DIFFERENT filings, with two DIFFERENT addresses and
    // phones (not a re-observation of the same natural key — a person who
    // simply moved). A grouping key that ignored the address/phone half
    // would wrongly merge these into one row.
    const delta1 = await observer.observePerson({
      accession_number: "ACC-5",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 2004,
      last_name: "Delta",
      address_id: "addr-delta-1",
      international_number: "+1-555-0501",
    });
    const delta2 = await observer.observePerson({
      accession_number: "ACC-6",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 2004,
      last_name: "Delta",
      address_id: "addr-delta-2",
      international_number: "+1-555-0502",
    });
    expect(delta2.canonical_person_id).toBe(delta1.canonical_person_id);

    const addressStorage = globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN);
    const phoneStorage = globalServiceRegistry.get(CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN);

    const addressSnapshot = (await addressStorage.getAll()) ?? [];
    const phoneSnapshot = (await phoneStorage.getAll()) ?? [];

    // Sanity on the incremental path itself: the changed-address
    // re-observation must leave no trace of the original address/phone —
    // proof `removePriorPersonJunctions` actually ran.
    expect(addressSnapshot.some((r) => r.address_hash_id === "addr-gamma-original")).toBe(false);
    expect(phoneSnapshot.some((r) => r.international_number === "+1-555-0300")).toBe(false);
    // Alpha/Beta/Gamma/Delta's two addresses each = 5 distinct rows; same
    // shape for phone minus Beta (no phone) = 4.
    expect(addressSnapshot).toHaveLength(5);
    expect(phoneSnapshot).toHaveLength(4);

    const result = await rebuildPersonJunctions(RESOLVER_VERSION);

    expect(result.addressRows).toBe(5);
    expect(result.phoneRows).toBe(4);

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

    // Delta's two addresses are two SEPARATE rows, each count 1 — proof the
    // grouping key includes the address, not just the canonical person.
    const delta1Addr = rebuiltAddrByKey.get(
      personAddressKey({
        canonical_person_id: delta1.canonical_person_id,
        address_hash_id: "addr-delta-1",
      })
    )!;
    const delta2Addr = rebuiltAddrByKey.get(
      personAddressKey({
        canonical_person_id: delta1.canonical_person_id,
        address_hash_id: "addr-delta-2",
      })
    )!;
    expect(delta1Addr).toBeDefined();
    expect(delta2Addr).toBeDefined();
    expect(delta1Addr.observation_count).toBe(1);
    expect(delta1Addr.first_seen_at).toBe("2024-05-05");
    expect(delta1Addr.last_seen_at).toBe("2024-05-05");
    expect(delta2Addr.observation_count).toBe(1);
    expect(delta2Addr.first_seen_at).toBe("2024-05-20");
    expect(delta2Addr.last_seen_at).toBe("2024-05-20");

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

    // Delta's two phones are likewise two separate rows.
    const delta1Phone = rebuiltPhoneByKey.get(
      personPhoneKey({
        canonical_person_id: delta1.canonical_person_id,
        international_number: "+1-555-0501",
      })
    )!;
    const delta2Phone = rebuiltPhoneByKey.get(
      personPhoneKey({
        canonical_person_id: delta1.canonical_person_id,
        international_number: "+1-555-0502",
      })
    )!;
    expect(delta1Phone.observation_count).toBe(1);
    expect(delta2Phone.observation_count).toBe(1);

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

  it("replaces rather than merges: re-keying an observation's link to a different canonical id drops the stale row on the next rebuild", async () => {
    // A merge (skipping `deleteForResolverVersion`) cannot be told apart from
    // a correct replace when nothing changes between two rebuilds — both
    // just overwrite the same composite PK with the same values. Mutating
    // the identity link BETWEEN two rebuilds — as a resolver re-key ceremony
    // would — moves the group to a NEW composite PK, so a merge would leave
    // the OLD PK's row sitting untouched forever.
    await seedFiling("ACC-20", 9000, "2024-08-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    const solo = await observer.observePerson({
      accession_number: "ACC-20",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 9101,
      last_name: "Solo",
      address_id: "addr-solo",
      international_number: "+1-555-9000",
    });

    await rebuildPersonJunctions(RESOLVER_VERSION);

    const addressStorage = globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN);
    const phoneStorage = globalServiceRegistry.get(CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN);
    expect(await addressStorage.getAll()).toEqual([
      expect.objectContaining({
        canonical_person_id: solo.canonical_person_id,
        address_hash_id: "addr-solo",
      }),
    ]);

    const reassignedCanonicalId = "reassigned-canonical-person";
    await new PersonIdentityLinkRepo().upsert(
      solo.observation_id,
      RESOLVER_VERSION,
      reassignedCanonicalId
    );

    await rebuildPersonJunctions(RESOLVER_VERSION);

    const rebuiltAddresses = (await addressStorage.getAll()) ?? [];
    const rebuiltPhones = (await phoneStorage.getAll()) ?? [];

    // The stale row under the OLD canonical id must be gone — a merge would
    // have left it sitting untouched alongside the new one.
    expect(rebuiltAddresses.some((r) => r.canonical_person_id === solo.canonical_person_id)).toBe(
      false
    );
    expect(rebuiltPhones.some((r) => r.canonical_person_id === solo.canonical_person_id)).toBe(
      false
    );
    expect(rebuiltAddresses).toEqual([
      expect.objectContaining({
        canonical_person_id: reassignedCanonicalId,
        address_hash_id: "addr-solo",
      }),
    ]);
    expect(rebuiltPhones).toEqual([
      expect.objectContaining({
        canonical_person_id: reassignedCanonicalId,
        international_number: "+1-555-9000",
      }),
    ]);
  });

  it("raises rather than silently skipping when an identity link has no matching observation", async () => {
    // A dangling link should never occur in practice (removing an
    // observation always removes its links too — see
    // `reapStaleObservations`), but it is exactly what a backend id-type
    // mismatch (a widened Postgres integer, a safe-integers SQLite handle)
    // would look like: every lookup misses. Silently skipping would empty
    // every group and let `deleteForResolverVersion` run with nothing to
    // replace it, so this must raise rather than return `{addressRows: 0,
    // phoneRows: 0}` as if that were a legitimate empty result.
    await new PersonIdentityLinkRepo().upsert(999999, RESOLVER_VERSION, "orphan-canonical-person");

    await expect(rebuildPersonJunctions(RESOLVER_VERSION)).rejects.toThrow(
      /no matching observation/
    );
  });

  it("raises rather than fabricating a date when an observation's filing row is missing", async () => {
    // The mirror of the dangling-link guard, one join further along: the
    // observation is there, the filing it cites is not, so there is no date to
    // derive the seen-at bounds from. Writing the row anyway would date a
    // junction from nothing.
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    await observer.observePerson({
      // Deliberately never passed to `seedFiling`.
      accession_number: "ACC-NO-FILING",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 4101,
      last_name: "Nofiling",
      address_id: "addr-nofiling",
      international_number: "+1-555-7100",
    });

    await expect(rebuildPersonJunctions(RESOLVER_VERSION)).rejects.toThrow(
      /no filing found for accession_number "ACC-NO-FILING"/
    );
  });

  it("purges only its own resolver version, leaving a previous generation's rows intact", async () => {
    // The purge is what makes the projection a replace rather than a merge,
    // but it is scoped to one generation: `dropPrevious` retires a version
    // while the active one keeps serving the `current_canonical_*` views, so a
    // rebuild must leave every other version's rows exactly where they are.
    const previousAddressRepo = new CanonicalPersonAddressRepo();
    await previousAddressRepo.recordObservation({
      canonical_person_id: "previous-canonical-person",
      address_hash_id: "addr-previous",
      resolver_version: PREVIOUS_RESOLVER_VERSION,
      seen_at: "2023-01-01T00:00:00.000Z",
    });
    await previousAddressRepo.recordObservation({
      canonical_person_id: "previous-canonical-person",
      address_hash_id: "addr-previous",
      resolver_version: PREVIOUS_RESOLVER_VERSION,
      seen_at: "2023-02-02T00:00:00.000Z",
    });
    await new CanonicalPersonPhoneRepo().recordObservation({
      canonical_person_id: "previous-canonical-person",
      international_number: "+1-555-7000",
      resolver_version: PREVIOUS_RESOLVER_VERSION,
      seen_at: "2023-01-01T00:00:00.000Z",
    });

    await seedFiling("ACC-30", 9000, "2024-09-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    await observer.observePerson({
      accession_number: "ACC-30",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 4001,
      last_name: "Active",
      address_id: "addr-active",
      international_number: "+1-555-7001",
    });

    expect(await rebuildPersonJunctions(RESOLVER_VERSION)).toEqual({
      addressRows: 1,
      phoneRows: 1,
    });

    const addressStorage = globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN);
    const phoneStorage = globalServiceRegistry.get(CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN);
    const addressRows = (await addressStorage.getAll()) ?? [];
    const phoneRows = (await phoneStorage.getAll()) ?? [];

    // The retired generation survives with its own counts and its own
    // wall-clock seen-at bounds — not recomputed, not deleted.
    expect(addressRows.filter((r) => r.resolver_version === PREVIOUS_RESOLVER_VERSION)).toEqual([
      {
        canonical_person_id: "previous-canonical-person",
        address_hash_id: "addr-previous",
        resolver_version: PREVIOUS_RESOLVER_VERSION,
        observation_count: 2,
        first_seen_at: "2023-01-01T00:00:00.000Z",
        last_seen_at: "2023-02-02T00:00:00.000Z",
      },
    ]);
    expect(phoneRows.filter((r) => r.resolver_version === PREVIOUS_RESOLVER_VERSION)).toEqual([
      {
        canonical_person_id: "previous-canonical-person",
        international_number: "+1-555-7000",
        resolver_version: PREVIOUS_RESOLVER_VERSION,
        observation_count: 1,
        first_seen_at: "2023-01-01T00:00:00.000Z",
        last_seen_at: "2023-01-01T00:00:00.000Z",
      },
    ]);
    // …while the rebuilt version holds exactly what the projection computed.
    expect(addressRows.filter((r) => r.resolver_version === RESOLVER_VERSION)).toHaveLength(1);
    expect(phoneRows.filter((r) => r.resolver_version === RESOLVER_VERSION)).toHaveLength(1);
  });

  it("purges the resolver version's rows even when the projection computes nothing", async () => {
    // Skipping the purge for an empty projection reads as defensive ("do not
    // wipe the table over a computed nothing") and would strand a version's
    // rows forever once a reap took its last observation — exactly the case
    // where no later write comes along to overwrite them.
    await seedFiling("ACC-40", 9000, "2024-10-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    const solo = await observer.observePerson({
      accession_number: "ACC-40",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 4201,
      last_name: "Reaped",
      address_id: "addr-reaped",
      international_number: "+1-555-7200",
    });

    expect(await rebuildPersonJunctions(RESOLVER_VERSION)).toEqual({
      addressRows: 1,
      phoneRows: 1,
    });
    const addressStorage = globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN);
    const phoneStorage = globalServiceRegistry.get(CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN);
    expect(await addressStorage.getAll()).toHaveLength(1);
    expect(await phoneStorage.getAll()).toHaveLength(1);

    // A reap, in the order `reapStaleObservations` does it: the links first,
    // then the observation row they pointed at.
    await new PersonIdentityLinkRepo().deleteForObservation(solo.observation_id);
    await new PersonObservationRepo().deleteByObservationId(solo.observation_id);

    expect(await rebuildPersonJunctions(RESOLVER_VERSION)).toEqual({
      addressRows: 0,
      phoneRows: 0,
    });
    expect(
      ((await addressStorage.getAll()) ?? []).filter((r) => r.resolver_version === RESOLVER_VERSION)
    ).toEqual([]);
    expect(
      ((await phoneStorage.getAll()) ?? []).filter((r) => r.resolver_version === RESOLVER_VERSION)
    ).toEqual([]);
  });
});

describe("rebuildCompanyJunctions", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("matches the incrementally maintained company junctions on keys and observation_count, including a re-observation with a changed address and a company with two distinct phones", async () => {
    await seedFiling("CACC-1", 8000, "2024-06-01");
    await seedFiling("CACC-2", 8000, "2024-06-15");
    await seedFiling("CACC-3", 8000, "2024-07-01");
    await seedFiling("CACC-4", 8000, "2024-07-15");
    await seedFiling("CACC-5", 8000, "2024-07-30");

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
    // Echo, via two DIFFERENT filings, with two DIFFERENT addresses AND
    // phones — proof the company-side grouping key is sensitive to the
    // address/phone half, not just the canonical company id.
    const echo1 = await observer.observeCompany({
      accession_number: "CACC-4",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 5003,
      name: "Echo Inc",
      address_id: "addr-echo-1",
      international_number: "+1-555-3000",
    });
    const echo2 = await observer.observeCompany({
      accession_number: "CACC-5",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 5003,
      name: "Echo Inc",
      address_id: "addr-echo-2",
      international_number: "+1-555-3001",
    });
    expect(echo2.canonical_company_id).toBe(echo1.canonical_company_id);

    const addressStorage = globalServiceRegistry.get(CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN);
    const phoneStorage = globalServiceRegistry.get(CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN);
    const addressSnapshot = (await addressStorage.getAll()) ?? [];
    const phoneSnapshot = (await phoneStorage.getAll()) ?? [];

    expect(addressSnapshot.some((r) => r.address_hash_id === "addr-hq")).toBe(false);
    expect(phoneSnapshot.some((r) => r.international_number === "+1-555-2000")).toBe(false);
    // Acme(1) + Beta(1) + Echo's two addresses = 4.
    expect(addressSnapshot).toHaveLength(4);
    // Acme(1) + Echo's two phones = 3 (Beta has no phone).
    expect(phoneSnapshot).toHaveLength(3);

    const result = await rebuildCompanyJunctions(RESOLVER_VERSION);

    expect(result.addressRows).toBe(4);
    expect(result.phoneRows).toBe(3);

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
    const snapshotPhoneByKey = byKey(phoneSnapshot, companyPhoneKey);
    const rebuiltPhoneByKey = byKey(rebuiltPhones, companyPhoneKey);
    for (const [key, snap] of snapshotPhoneByKey) {
      expect(rebuiltPhoneByKey.get(key)?.observation_count).toBe(snap.observation_count);
    }

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
    expect(betaAddr.last_seen_at).toBe("2024-06-15");

    // Echo's two addresses are two separate rows.
    const echo1Addr = rebuiltAddrByKey.get(
      companyAddressKey({
        canonical_company_id: echo1.canonical_company_id,
        address_hash_id: "addr-echo-1",
      })
    )!;
    const echo2Addr = rebuiltAddrByKey.get(
      companyAddressKey({
        canonical_company_id: echo1.canonical_company_id,
        address_hash_id: "addr-echo-2",
      })
    )!;
    expect(echo1Addr.observation_count).toBe(1);
    expect(echo1Addr.first_seen_at).toBe("2024-07-15");
    expect(echo2Addr.observation_count).toBe(1);
    expect(echo2Addr.first_seen_at).toBe("2024-07-30");

    const acmePhone = rebuiltPhoneByKey.get(
      companyPhoneKey({
        canonical_company_id: acme.canonical_company_id,
        international_number: "+1-555-2001",
      })
    )!;
    expect(acmePhone.observation_count).toBe(2);
    expect(acmePhone.first_seen_at).toBe("2024-06-01");
    expect(acmePhone.last_seen_at).toBe("2024-07-01");

    // Echo's two phones are two separate rows — the phone-side key
    // sensitivity check the mirror is specifically for.
    const echo1Phone = rebuiltPhoneByKey.get(
      companyPhoneKey({
        canonical_company_id: echo1.canonical_company_id,
        international_number: "+1-555-3000",
      })
    )!;
    const echo2Phone = rebuiltPhoneByKey.get(
      companyPhoneKey({
        canonical_company_id: echo1.canonical_company_id,
        international_number: "+1-555-3001",
      })
    )!;
    expect(echo1Phone.observation_count).toBe(1);
    expect(echo1Phone.first_seen_at).toBe("2024-07-15");
    expect(echo2Phone.observation_count).toBe(1);
    expect(echo2Phone.first_seen_at).toBe("2024-07-30");

    // Timestamps are the one intended difference, same as the person side.
    const snapAcmeAddr = snapshotAddrByKey.get(
      companyAddressKey({
        canonical_company_id: acme.canonical_company_id,
        address_hash_id: "addr-hq-new",
      })
    )!;
    expect(snapAcmeAddr.first_seen_at).not.toBe(acmeAddr.first_seen_at);
    expect(snapAcmeAddr.first_seen_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("replaces rather than merges: re-keying an observation's link to a different canonical id drops the stale row on the next rebuild", async () => {
    await seedFiling("CACC-20", 8000, "2024-08-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    const solo = await observer.observeCompany({
      accession_number: "CACC-20",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 9201,
      name: "Solo Holdings",
      address_id: "addr-solo-hq",
      international_number: "+1-555-9500",
    });

    await rebuildCompanyJunctions(RESOLVER_VERSION);

    const addressStorage = globalServiceRegistry.get(CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN);
    const phoneStorage = globalServiceRegistry.get(CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN);
    expect(await addressStorage.getAll()).toEqual([
      expect.objectContaining({
        canonical_company_id: solo.canonical_company_id,
        address_hash_id: "addr-solo-hq",
      }),
    ]);

    const reassignedCanonicalId = "reassigned-canonical-company";
    await new CompanyIdentityLinkRepo().upsert(
      solo.observation_id,
      RESOLVER_VERSION,
      reassignedCanonicalId
    );

    await rebuildCompanyJunctions(RESOLVER_VERSION);

    const rebuiltAddresses = (await addressStorage.getAll()) ?? [];
    const rebuiltPhones = (await phoneStorage.getAll()) ?? [];

    expect(rebuiltAddresses.some((r) => r.canonical_company_id === solo.canonical_company_id)).toBe(
      false
    );
    expect(rebuiltPhones.some((r) => r.canonical_company_id === solo.canonical_company_id)).toBe(
      false
    );
    expect(rebuiltAddresses).toEqual([
      expect.objectContaining({
        canonical_company_id: reassignedCanonicalId,
        address_hash_id: "addr-solo-hq",
      }),
    ]);
    expect(rebuiltPhones).toEqual([
      expect.objectContaining({
        canonical_company_id: reassignedCanonicalId,
        international_number: "+1-555-9500",
      }),
    ]);
  });

  it("raises rather than silently skipping when a company identity link has no matching observation", async () => {
    await new CompanyIdentityLinkRepo().upsert(
      999999,
      RESOLVER_VERSION,
      "orphan-canonical-company"
    );

    await expect(rebuildCompanyJunctions(RESOLVER_VERSION)).rejects.toThrow(
      /no matching observation/
    );
  });

  it("raises rather than fabricating a date when a company observation's filing row is missing", async () => {
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    await observer.observeCompany({
      // Deliberately never passed to `seedFiling`.
      accession_number: "CACC-NO-FILING",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 6101,
      name: "Nofiling Corp",
      address_id: "addr-nofiling-hq",
      international_number: "+1-555-8100",
    });

    await expect(rebuildCompanyJunctions(RESOLVER_VERSION)).rejects.toThrow(
      /no filing found for accession_number "CACC-NO-FILING"/
    );
  });

  it("purges only its own resolver version, leaving a previous generation's rows intact", async () => {
    const previousAddressRepo = new CanonicalCompanyAddressRepo();
    await previousAddressRepo.recordObservation({
      canonical_company_id: "previous-canonical-company",
      address_hash_id: "addr-previous-hq",
      resolver_version: PREVIOUS_RESOLVER_VERSION,
      seen_at: "2023-03-03T00:00:00.000Z",
    });
    await previousAddressRepo.recordObservation({
      canonical_company_id: "previous-canonical-company",
      address_hash_id: "addr-previous-hq",
      resolver_version: PREVIOUS_RESOLVER_VERSION,
      seen_at: "2023-04-04T00:00:00.000Z",
    });
    await new CanonicalCompanyPhoneRepo().recordObservation({
      canonical_company_id: "previous-canonical-company",
      international_number: "+1-555-8000",
      resolver_version: PREVIOUS_RESOLVER_VERSION,
      seen_at: "2023-03-03T00:00:00.000Z",
    });

    await seedFiling("CACC-30", 8000, "2024-09-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    await observer.observeCompany({
      accession_number: "CACC-30",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 6001,
      name: "Active Corp",
      address_id: "addr-active-hq",
      international_number: "+1-555-8001",
    });

    expect(await rebuildCompanyJunctions(RESOLVER_VERSION)).toEqual({
      addressRows: 1,
      phoneRows: 1,
    });

    const addressStorage = globalServiceRegistry.get(CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN);
    const phoneStorage = globalServiceRegistry.get(CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN);
    const addressRows = (await addressStorage.getAll()) ?? [];
    const phoneRows = (await phoneStorage.getAll()) ?? [];

    expect(addressRows.filter((r) => r.resolver_version === PREVIOUS_RESOLVER_VERSION)).toEqual([
      {
        canonical_company_id: "previous-canonical-company",
        address_hash_id: "addr-previous-hq",
        resolver_version: PREVIOUS_RESOLVER_VERSION,
        observation_count: 2,
        first_seen_at: "2023-03-03T00:00:00.000Z",
        last_seen_at: "2023-04-04T00:00:00.000Z",
      },
    ]);
    expect(phoneRows.filter((r) => r.resolver_version === PREVIOUS_RESOLVER_VERSION)).toEqual([
      {
        canonical_company_id: "previous-canonical-company",
        international_number: "+1-555-8000",
        resolver_version: PREVIOUS_RESOLVER_VERSION,
        observation_count: 1,
        first_seen_at: "2023-03-03T00:00:00.000Z",
        last_seen_at: "2023-03-03T00:00:00.000Z",
      },
    ]);
    expect(addressRows.filter((r) => r.resolver_version === RESOLVER_VERSION)).toHaveLength(1);
    expect(phoneRows.filter((r) => r.resolver_version === RESOLVER_VERSION)).toHaveLength(1);
  });

  it("purges the resolver version's rows even when the projection computes nothing", async () => {
    await seedFiling("CACC-40", 8000, "2024-10-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    const solo = await observer.observeCompany({
      accession_number: "CACC-40",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 6201,
      name: "Reaped Holdings",
      address_id: "addr-reaped-hq",
      international_number: "+1-555-8200",
    });

    expect(await rebuildCompanyJunctions(RESOLVER_VERSION)).toEqual({
      addressRows: 1,
      phoneRows: 1,
    });
    const addressStorage = globalServiceRegistry.get(CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN);
    const phoneStorage = globalServiceRegistry.get(CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN);
    expect(await addressStorage.getAll()).toHaveLength(1);
    expect(await phoneStorage.getAll()).toHaveLength(1);

    await new CompanyIdentityLinkRepo().deleteForObservation(solo.observation_id);
    await new CompanyObservationRepo().deleteByObservationId(solo.observation_id);

    expect(await rebuildCompanyJunctions(RESOLVER_VERSION)).toEqual({
      addressRows: 0,
      phoneRows: 0,
    });
    expect(
      ((await addressStorage.getAll()) ?? []).filter((r) => r.resolver_version === RESOLVER_VERSION)
    ).toEqual([]);
    expect(
      ((await phoneStorage.getAll()) ?? []).filter((r) => r.resolver_version === RESOLVER_VERSION)
    ).toEqual([]);
  });
});
