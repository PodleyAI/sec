/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import type { PersonObservation } from "../storage/observation/PersonObservationSchema";
import type { CompanyObservation } from "../storage/observation/CompanyObservationSchema";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import type { PersonIdentityLink } from "../storage/canonical/PersonIdentityLinkSchema";
import type { CompanyIdentityLink } from "../storage/canonical/CompanyIdentityLinkSchema";
import { CanonicalPersonAddressRepo } from "../storage/canonical/CanonicalPersonAddressRepo";
import { CanonicalPersonPhoneRepo } from "../storage/canonical/CanonicalPersonPhoneRepo";
import { CanonicalCompanyAddressRepo } from "../storage/canonical/CanonicalCompanyAddressRepo";
import { CanonicalCompanyPhoneRepo } from "../storage/canonical/CanonicalCompanyPhoneRepo";

/**
 * Accession numbers per `in`-list query — see `PersonObservationTitleRepo`'s
 * constant of the same name for the rationale (SQLite binds one bind
 * parameter per value).
 */
const MAX_ACCESSIONS_PER_QUERY = 900;

export interface JunctionRebuildResult {
  readonly addressRows: number;
  readonly phoneRows: number;
}

/** Running count plus seen-at bounds for one `(canonical id, address/phone)` group. */
interface JunctionAggregate {
  count: number;
  first_seen_at: string;
  last_seen_at: string;
}

/**
 * Folds one asserting filing's date into a group's running count and
 * seen-at bounds. `filing_date` is `YYYY-MM-DD`, so plain string comparison
 * orders it correctly.
 */
function accumulate(
  groups: Map<string, JunctionAggregate>,
  key: string,
  filing_date: string
): void {
  const existing = groups.get(key);
  if (existing === undefined) {
    groups.set(key, { count: 1, first_seen_at: filing_date, last_seen_at: filing_date });
    return;
  }
  existing.count += 1;
  if (filing_date < existing.first_seen_at) existing.first_seen_at = filing_date;
  if (filing_date > existing.last_seen_at) existing.last_seen_at = filing_date;
}

/** `accession_number -> filing_date`, chunked for the storage layer's `in`-list bind limit. */
async function loadFilingDates(accession_numbers: readonly string[]): Promise<Map<string, string>> {
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const distinct = [...new Set(accession_numbers)];
  const byAccession = new Map<string, string>();
  for (let start = 0; start < distinct.length; start += MAX_ACCESSIONS_PER_QUERY) {
    const chunk = distinct.slice(start, start + MAX_ACCESSIONS_PER_QUERY);
    const filings =
      (await filingRepo.query({ accession_number: { value: chunk, operator: "in" } })) ?? [];
    for (const filing of filings) {
      byAccession.set(filing.accession_number, filing.filing_date);
    }
  }
  return byAccession;
}

/**
 * The asserting filing's date for one observation. An observation with no
 * matching filing row would leave a junction group with no seen-at bound to
 * compute, which means the tier's data no longer satisfies the invariant
 * every stored observation traces back to a stored filing — raising here
 * surfaces that corruption immediately rather than writing a junction row
 * with a fabricated date.
 */
function filingDateFor(byAccession: ReadonlyMap<string, string>, accession_number: string): string {
  const filing_date = byAccession.get(accession_number);
  if (filing_date === undefined) {
    throw new Error(
      `rebuildJunctions: no filing found for accession_number ${JSON.stringify(accession_number)}`
    );
  }
  return filing_date;
}

/**
 * Recomputes every person address/phone junction row at `resolverVersion`
 * from the current observations and their identity links, and replaces the
 * resolver version's rows outright.
 *
 * This is a projection, not a re-run of `EntityObserver`'s incremental
 * co-occurrence bookkeeping: it groups every person observation that has an
 * identity link at `resolverVersion` by `(canonical_person_id,
 * raw_address_id)` (and separately by `raw_phone_id`), so `observation_count`
 * is a plain count of the current group rather than a running total, and it
 * has no dependency on what a prior observation looked like. `first_seen_at`
 * / `last_seen_at` are the min/max `filing_date` of the asserting filings,
 * not the wall clock at write time.
 */
export async function rebuildPersonJunctions(
  resolverVersion: string
): Promise<JunctionRebuildResult> {
  const linkRepo = new PersonIdentityLinkRepo();
  const observationRepo = new PersonObservationRepo();
  const addressRepo = new CanonicalPersonAddressRepo();
  const phoneRepo = new CanonicalPersonPhoneRepo();

  const links: readonly PersonIdentityLink[] =
    await linkRepo.listForResolverVersion(resolverVersion);
  const observations: readonly PersonObservation[] = await observationRepo.listByIds(
    links.map((link) => link.observation_id)
  );
  const observationById = new Map(observations.map((o) => [o.observation_id, o]));
  const filingDates = await loadFilingDates(observations.map((o) => o.accession_number));

  const addressGroups = new Map<string, JunctionAggregate>();
  const addressIds = new Map<string, { canonical_person_id: string; address_hash_id: string }>();
  const phoneGroups = new Map<string, JunctionAggregate>();
  const phoneIds = new Map<string, { canonical_person_id: string; international_number: string }>();

  for (const link of links) {
    const observation = observationById.get(link.observation_id);
    if (observation === undefined) continue;
    const filing_date = filingDateFor(filingDates, observation.accession_number);

    if (observation.raw_address_id) {
      const key = `${link.canonical_person_id}\x00${observation.raw_address_id}`;
      accumulate(addressGroups, key, filing_date);
      addressIds.set(key, {
        canonical_person_id: link.canonical_person_id,
        address_hash_id: observation.raw_address_id,
      });
    }
    if (observation.raw_phone_id) {
      const key = `${link.canonical_person_id}\x00${observation.raw_phone_id}`;
      accumulate(phoneGroups, key, filing_date);
      phoneIds.set(key, {
        canonical_person_id: link.canonical_person_id,
        international_number: observation.raw_phone_id,
      });
    }
  }

  await addressRepo.deleteForResolverVersion(resolverVersion);
  for (const [key, aggregate] of addressGroups) {
    await addressRepo.putRow({
      ...addressIds.get(key)!,
      resolver_version: resolverVersion,
      observation_count: aggregate.count,
      first_seen_at: aggregate.first_seen_at,
      last_seen_at: aggregate.last_seen_at,
    });
  }

  await phoneRepo.deleteForResolverVersion(resolverVersion);
  for (const [key, aggregate] of phoneGroups) {
    await phoneRepo.putRow({
      ...phoneIds.get(key)!,
      resolver_version: resolverVersion,
      observation_count: aggregate.count,
      first_seen_at: aggregate.first_seen_at,
      last_seen_at: aggregate.last_seen_at,
    });
  }

  return { addressRows: addressGroups.size, phoneRows: phoneGroups.size };
}

/** Company counterpart of {@link rebuildPersonJunctions} — the exact mirror on `canonical_company_id`. */
export async function rebuildCompanyJunctions(
  resolverVersion: string
): Promise<JunctionRebuildResult> {
  const linkRepo = new CompanyIdentityLinkRepo();
  const observationRepo = new CompanyObservationRepo();
  const addressRepo = new CanonicalCompanyAddressRepo();
  const phoneRepo = new CanonicalCompanyPhoneRepo();

  const links: readonly CompanyIdentityLink[] =
    await linkRepo.listForResolverVersion(resolverVersion);
  const observations: readonly CompanyObservation[] = await observationRepo.listByIds(
    links.map((link) => link.observation_id)
  );
  const observationById = new Map(observations.map((o) => [o.observation_id, o]));
  const filingDates = await loadFilingDates(observations.map((o) => o.accession_number));

  const addressGroups = new Map<string, JunctionAggregate>();
  const addressIds = new Map<string, { canonical_company_id: string; address_hash_id: string }>();
  const phoneGroups = new Map<string, JunctionAggregate>();
  const phoneIds = new Map<
    string,
    { canonical_company_id: string; international_number: string }
  >();

  for (const link of links) {
    const observation = observationById.get(link.observation_id);
    if (observation === undefined) continue;
    const filing_date = filingDateFor(filingDates, observation.accession_number);

    if (observation.raw_address_id) {
      const key = `${link.canonical_company_id}\x00${observation.raw_address_id}`;
      accumulate(addressGroups, key, filing_date);
      addressIds.set(key, {
        canonical_company_id: link.canonical_company_id,
        address_hash_id: observation.raw_address_id,
      });
    }
    if (observation.raw_phone_id) {
      const key = `${link.canonical_company_id}\x00${observation.raw_phone_id}`;
      accumulate(phoneGroups, key, filing_date);
      phoneIds.set(key, {
        canonical_company_id: link.canonical_company_id,
        international_number: observation.raw_phone_id,
      });
    }
  }

  await addressRepo.deleteForResolverVersion(resolverVersion);
  for (const [key, aggregate] of addressGroups) {
    await addressRepo.putRow({
      ...addressIds.get(key)!,
      resolver_version: resolverVersion,
      observation_count: aggregate.count,
      first_seen_at: aggregate.first_seen_at,
      last_seen_at: aggregate.last_seen_at,
    });
  }

  await phoneRepo.deleteForResolverVersion(resolverVersion);
  for (const [key, aggregate] of phoneGroups) {
    await phoneRepo.putRow({
      ...phoneIds.get(key)!,
      resolver_version: resolverVersion,
      observation_count: aggregate.count,
      first_seen_at: aggregate.first_seen_at,
      last_seen_at: aggregate.last_seen_at,
    });
  }

  return { addressRows: addressGroups.size, phoneRows: phoneGroups.size };
}
