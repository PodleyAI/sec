/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { CanonicalPersonAddressRepo } from "../storage/canonical/CanonicalPersonAddressRepo";
import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { buildEntityObserver } from "./buildEntityObserver";
import { reapStaleObservations } from "./reapStaleObservations";

const V = "1.0.0";
const ACC = "0001-25-000001";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function observer() {
  return buildEntityObserver({ activeResolverPersonVersion: V, activeResolverCompanyVersion: V });
}

// Distinct CIKs so each resolves to its own canonical via the resolver CIK
// fast-path (a bare surname with no first name normalizes to all-null name
// fields, which would otherwise collapse them onto the shared issuer_cik).
function personClaim(index: number, addr: string) {
  return {
    accession_number: ACC,
    extractor_id: "S-1",
    extractor_version: "1.0.0",
    observation_index: index,
    cik: 1000 + index,
    source_filing_issuer_cik: 999,
    last_name: `Director${index}`,
    address_id: addr,
  };
}

describe("reapStaleObservations", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("reaps orphan observations a smaller re-extraction leaves behind, with their links + junctions", async () => {
    const obs = observer();
    const personObs = new PersonObservationRepo();
    const links = new PersonIdentityLinkRepo();
    const addr = new CanonicalPersonAddressRepo();

    // v1 extraction: three directors at indices 0,1,2.
    await obs.observePerson(personClaim(0, "addr0"));
    await obs.observePerson(personClaim(1, "addr1"));
    const orphan = await obs.observePerson(personClaim(2, "addr2"));

    await sleep(5);
    const runStart = new Date().toISOString();

    // v2 re-extraction yields only two directors (indices 0,1).
    await obs.observePerson(personClaim(0, "addr0"));
    await obs.observePerson(personClaim(1, "addr1"));

    const { reaped } = await reapStaleObservations({
      accession_number: ACC,
      extractor_id: "S-1",
      before: runStart,
    });

    expect(reaped).toBe(1);

    // Orphan index 2 is gone; the live rows survive (with stable ids).
    const remaining = await personObs.listByAccessionAndExtractor(ACC, "S-1");
    expect(remaining.map((o) => o.observation_index).sort()).toEqual([0, 1]);

    // The orphan's identity link is gone (no phantom canonical linkage).
    expect(await links.listForObservation(orphan.observation_id)).toEqual([]);

    // The orphan's address junction is gone; the live ones remain at count 1.
    expect(await addr.listForCanonical(orphan.canonical_person_id, V)).toEqual([]);
  });

  it("keeps junction counts idempotent across replays (no blind +1)", async () => {
    const obs = observer();
    const addr = new CanonicalPersonAddressRepo();

    const first = await obs.observePerson(personClaim(0, "addr0"));
    // Re-observe the SAME natural key three more times (a replay loop).
    await obs.observePerson(personClaim(0, "addr0"));
    await obs.observePerson(personClaim(0, "addr0"));
    await obs.observePerson(personClaim(0, "addr0"));

    const rows = await addr.listForCanonical(first.canonical_person_id, V);
    expect(rows.length).toBe(1);
    // Without the prior-contribution decrement this would be 4.
    expect(rows[0].observation_count).toBe(1);
  });

  it("removes the stale-kind orphan when a reporting owner is reclassified company->person", async () => {
    const obs = observer();
    const personObs = new PersonObservationRepo();
    const companyObs = new CompanyObservationRepo();
    const companyLinks = new CompanyIdentityLinkRepo();

    // v1 classifies the owner at index 5 as a COMPANY.
    const company = await obs.observeCompany({
      accession_number: ACC,
      extractor_id: "ownership",
      extractor_version: "1.0.0",
      observation_index: 5,
      name: "Smith Family Trust LLC",
    });

    await sleep(5);
    const runStart = new Date().toISOString();

    // v2 reclassifies the same index as a PERSON (different table).
    await obs.observePerson({
      accession_number: ACC,
      extractor_id: "ownership",
      extractor_version: "1.0.0",
      observation_index: 5,
      source_filing_issuer_cik: 999,
      last_name: "Smith Family Trust",
    });

    await reapStaleObservations({
      accession_number: ACC,
      extractor_id: "ownership",
      before: runStart,
    });

    // The stale company observation (and its link) at index 5 is gone...
    expect(await companyObs.listByAccessionAndExtractor(ACC, "ownership")).toEqual([]);
    expect(await companyLinks.listForObservation(company.observation_id)).toEqual([]);
    // ...while the new person observation at the same index survives.
    const people = await personObs.listByAccessionAndExtractor(ACC, "ownership");
    expect(people.map((o) => o.observation_index)).toEqual([5]);
  });
});
