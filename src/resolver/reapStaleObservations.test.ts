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
import { buildObserveOnlyEntityObserver } from "./buildObserveOnlyEntityObserver";
import { resolveObservationsForAccession } from "./resolveObservationLinks";
import { reapStaleObservations } from "./reapStaleObservations";
import {
  clearObservationReapHooksForTesting,
  registerObservationReapHook,
  type ReapedObservation,
} from "./observationReapHooks";
import {
  registerIdentityLinkReap,
  resetIdentityLinkReapForTesting,
} from "./registerIdentityLinkReap";

const V = "1.0.0";
const ACC = "0001-25-000001";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function observer() {
  return buildObserveOnlyEntityObserver();
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
    clearObservationReapHooksForTesting();
    // The link deletion is a registered hook now, not something the reaper does
    // itself, so the production wiring has to be in place for these to mean
    // anything. `registerSecResolvers` makes this same call at bootstrap.
    resetIdentityLinkReapForTesting();
    registerIdentityLinkReap();
  });

  it("reaps orphan observations a smaller re-extraction leaves behind, with their links", async () => {
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

    // Resolved before the reap, so there is a link to be left dangling. That is
    // the whole hazard: a rebuild raises on one rather than writing around it,
    // and a raise leaves its tables untouched — so a link the reap failed to
    // delete stops every later rebuild instead of corrupting one.
    await resolveObservationsForAccession({
      kind: "person",
      accession_number: ACC,
      resolverVersion: V,
    });
    expect(await links.listForObservation(orphan.observation_id)).toHaveLength(1);

    const { reaped } = await reapStaleObservations({
      accession_number: ACC,
      extractor_id: "S-1",
      before: runStart,
    });

    expect(reaped).toBe(1);

    // Orphan index 2 is gone; the live rows survive (with stable ids).
    const remaining = await personObs.listByAccessionAndExtractor(ACC, "S-1");
    expect(remaining.map((o) => o.observation_index).sort()).toEqual([0, 1]);

    // The orphan's identity link is gone (no phantom canonical linkage), while
    // the live rows keep theirs.
    expect(await links.listForObservation(orphan.observation_id)).toEqual([]);
    expect(await new PersonIdentityLinkRepo().count()).toBe(2);
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

  it("hands every reaped observation to each registered hook, and only those", async () => {
    // The seam a package holding its own observation-keyed rows joins through.
    // It is asserted to see exactly the reaped set: a hook that misses one
    // leaves a row keyed to an observation that is gone, and this suite is the
    // only place that notices — nothing here registers a hook in production.
    const seen: ReapedObservation[][] = [[], []];
    registerObservationReapHook(async (o) => {
      seen[0]!.push(o);
    });
    registerObservationReapHook(async (o) => {
      seen[1]!.push(o);
    });

    const obs = observer();
    await obs.observePerson(personClaim(0, "addr0"));
    const orphanPerson = await obs.observePerson(personClaim(1, "addr1"));
    const orphanCompany = await obs.observeCompany({
      accession_number: ACC,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      observation_index: 50,
      cik: 4242,
      name: "Reaped Holdings LLC",
    });

    await sleep(5);
    const runStart = new Date().toISOString();
    // Only index 0 is re-observed, so both orphans above are reaped.
    await obs.observePerson(personClaim(0, "addr0"));

    const { reaped } = await reapStaleObservations({
      accession_number: ACC,
      extractor_id: "S-1",
      before: runStart,
    });
    expect(reaped).toBe(2);

    const expected = [
      { kind: "person", observation_id: orphanPerson.observation_id },
      { kind: "company", observation_id: orphanCompany.observation_id },
    ];
    // Every hook sees every reaped observation, and nothing that survived.
    expect(seen[0]).toEqual(expected);
    expect(seen[1]).toEqual(expected);
  });

  it("lets a hook's failure take the reap with it", async () => {
    // An incomplete reap is not a smaller reap: the row the hook failed to
    // delete is keyed to an observation about to disappear, and after that
    // nothing can name it. Raising leaves the filing to a dead letter and a
    // re-run rather than reporting a reap that did not happen.
    registerObservationReapHook(async () => {
      throw new Error("downstream cleanup unavailable");
    });

    const obs = observer();
    await obs.observePerson(personClaim(0, "addr0"));
    await obs.observePerson(personClaim(1, "addr1"));
    await sleep(5);
    const runStart = new Date().toISOString();
    await obs.observePerson(personClaim(0, "addr0"));

    await expect(
      reapStaleObservations({ accession_number: ACC, extractor_id: "S-1", before: runStart })
    ).rejects.toThrow(/downstream cleanup unavailable/);
  });
});
