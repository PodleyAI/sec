/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import { CanonicalPersonAddressRepo } from "../storage/canonical/CanonicalPersonAddressRepo";
import { CanonicalPersonPhoneRepo } from "../storage/canonical/CanonicalPersonPhoneRepo";
import { CanonicalCompanyAddressRepo } from "../storage/canonical/CanonicalCompanyAddressRepo";
import { CanonicalCompanyPhoneRepo } from "../storage/canonical/CanonicalCompanyPhoneRepo";
import { ObservationProvenanceRepo } from "../storage/provenance/ObservationProvenanceRepo";

export interface ReapStaleObservationsArgs {
  readonly accession_number: string;
  readonly extractor_id: string;
  /**
   * Run-start timestamp (ISO 8601). Observations for this filing+extractor whose
   * `created_at` is strictly older were NOT re-observed by the current run, so
   * they are stale orphans from a prior (larger / differently-classified)
   * extraction and are reaped. `upsertByNaturalKey` refreshes `created_at` to
   * the run time on every re-observe, so surviving rows keep their stable
   * `observation_id` (and the beneficial-ownership / related-party / merger FKs
   * that reference it stay valid).
   */
  readonly before: string;
}

export interface ReapStaleObservationsDeps {
  personObservationRepo?: PersonObservationRepo;
  companyObservationRepo?: CompanyObservationRepo;
  personIdentityLinkRepo?: PersonIdentityLinkRepo;
  companyIdentityLinkRepo?: CompanyIdentityLinkRepo;
  canonicalPersonAddressRepo?: CanonicalPersonAddressRepo;
  canonicalPersonPhoneRepo?: CanonicalPersonPhoneRepo;
  canonicalCompanyAddressRepo?: CanonicalCompanyAddressRepo;
  canonicalCompanyPhoneRepo?: CanonicalCompanyPhoneRepo;
  observationProvenanceRepo?: ObservationProvenanceRepo;
}

/**
 * Remove the phantom rows a re-extraction leaves behind. Observation rows are
 * upserted by positional `(accession, extractor_id, observation_index)`, so a
 * re-extraction that yields FEWER entities — or reclassifies one from company
 * to person (a different table at the same index) — overwrites the live rows
 * but never deletes the now-stale high-index / wrong-kind rows. Those orphans
 * stay joined to canonical entities through their identity links, manufacturing
 * entities the filing no longer describes.
 *
 * Run AFTER a successful extraction. For each observation of (accession,
 * extractor_id) not refreshed this run (`created_at < before`): decrement its
 * address/phone junction contributions (via its links, so the count tracks live
 * observations), delete its identity links (all resolver versions) and
 * provenance, then delete the observation row. Re-observed rows are untouched.
 */
export async function reapStaleObservations(
  args: ReapStaleObservationsArgs,
  deps: ReapStaleObservationsDeps = {}
): Promise<{ reaped: number }> {
  const personObs = deps.personObservationRepo ?? new PersonObservationRepo();
  const companyObs = deps.companyObservationRepo ?? new CompanyObservationRepo();
  const personLinks = deps.personIdentityLinkRepo ?? new PersonIdentityLinkRepo();
  const companyLinks = deps.companyIdentityLinkRepo ?? new CompanyIdentityLinkRepo();
  const personAddr = deps.canonicalPersonAddressRepo ?? new CanonicalPersonAddressRepo();
  const personPhone = deps.canonicalPersonPhoneRepo ?? new CanonicalPersonPhoneRepo();
  const companyAddr = deps.canonicalCompanyAddressRepo ?? new CanonicalCompanyAddressRepo();
  const companyPhone = deps.canonicalCompanyPhoneRepo ?? new CanonicalCompanyPhoneRepo();
  const provenance = deps.observationProvenanceRepo ?? new ObservationProvenanceRepo();

  let reaped = 0;

  const people = await personObs.listByAccessionAndExtractor(
    args.accession_number,
    args.extractor_id
  );
  for (const o of people) {
    if (o.created_at >= args.before) continue; // refreshed this run — keep
    const links = await personLinks.listForObservation(o.observation_id);
    for (const link of links) {
      if (o.raw_address_id) {
        await personAddr.removeObservation({
          canonical_person_id: link.canonical_person_id,
          address_hash_id: o.raw_address_id,
          resolver_version: link.resolver_version,
        });
      }
      if (o.raw_phone_id) {
        await personPhone.removeObservation({
          canonical_person_id: link.canonical_person_id,
          international_number: o.raw_phone_id,
          resolver_version: link.resolver_version,
        });
      }
    }
    await personLinks.deleteForObservation(o.observation_id);
    await provenance.deleteForObservation("person", o.observation_id);
    await personObs.deleteByObservationId(o.observation_id);
    reaped++;
  }

  const companies = await companyObs.listByAccessionAndExtractor(
    args.accession_number,
    args.extractor_id
  );
  for (const o of companies) {
    if (o.created_at >= args.before) continue; // refreshed this run — keep
    const links = await companyLinks.listForObservation(o.observation_id);
    for (const link of links) {
      if (o.raw_address_id) {
        await companyAddr.removeObservation({
          canonical_company_id: link.canonical_company_id,
          address_hash_id: o.raw_address_id,
          resolver_version: link.resolver_version,
        });
      }
      if (o.raw_phone_id) {
        await companyPhone.removeObservation({
          canonical_company_id: link.canonical_company_id,
          international_number: o.raw_phone_id,
          resolver_version: link.resolver_version,
        });
      }
    }
    await companyLinks.deleteForObservation(o.observation_id);
    await provenance.deleteForObservation("company", o.observation_id);
    await companyObs.deleteByObservationId(o.observation_id);
    reaped++;
  }

  return { reaped };
}
