/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { loadFilingDates } from "./rebuildFilingDates";

export interface JunctionRebuildResult {
  readonly addressRows: number;
  readonly phoneRows: number;
}

/** What the rebuild reads off any observation, person or company. */
interface JunctionObservation {
  readonly observation_id: number;
  readonly accession_number: string;
  readonly raw_address_id: string | null;
  readonly raw_phone_id: string | null;
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
 * The observation a link points to. A miss here is never "this observation
 * just isn't part of the rebuild" — every live link has a backing
 * observation row, since removing one always removes the other (see
 * `reapStaleObservations`). It means either a dangling link left behind by a
 * bug, or the backend handed `observation_id` back as a type that does not
 * `===`-match what the link stored (a widened Postgres integer, a
 * safe-integers SQLite handle, a proxied storage) — the same failure mode
 * `PersonObservationTitleRepo.listForObservations` guards against, and here
 * it would miss on EVERY link at once, so raising is the only safe response:
 * silently skipping would empty every group, and the caller's
 * `deleteForResolverVersion` would then run with nothing to replace it —
 * deleting the resolver version's junction rows and writing none back.
 */
function observationFor<TObservation>(
  byId: ReadonlyMap<number, TObservation>,
  observation_id: number
): TObservation {
  const observation = byId.get(observation_id);
  if (observation === undefined) {
    throw new Error(
      `rebuildJunctions: identity link references observation_id ` +
        `${JSON.stringify(observation_id)} (${typeof observation_id}) with no matching ` +
        `observation row — dangling link, or a backend id-type mismatch?`
    );
  }
  return observation;
}

/** One side of an identity link, as the rebuild reads it. */
interface RebuildInputs<TLink, TObservation> {
  readonly links: readonly TLink[];
  readonly observations: readonly TObservation[];
  /** The canonical id a link points at — `canonical_person_id` or its company twin. */
  readonly canonicalIdOf: (link: TLink) => string;
  readonly observationIdOf: (link: TLink) => number;
}

/** Where the recomputed rows go, and under which id column. */
interface JunctionTargets {
  readonly addressRepo: {
    deleteForResolverVersion(resolver_version: string): Promise<number>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    replaceAggregate(row: any): Promise<void>;
  };
  readonly phoneRepo: {
    deleteForResolverVersion(resolver_version: string): Promise<number>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    replaceAggregate(row: any): Promise<void>;
  };
  /** `canonical_person_id` / `canonical_company_id` — the junction row's id column. */
  readonly idColumn: string;
}

/**
 * The shared body of {@link rebuildPersonJunctions} and
 * {@link rebuildCompanyJunctions}.
 *
 * The two tiers differ only in which repositories they read and which column
 * names the canonical id; every rule about what a junction row means — the
 * grouping, the plain group count, the filing-date bounds, the
 * purge-then-write — is one implementation, so a fix to either tier is a fix
 * to both.
 */
async function rebuildJunctions<TLink, TObservation extends JunctionObservation>(
  resolverVersion: string,
  inputs: RebuildInputs<TLink, TObservation>,
  targets: JunctionTargets
): Promise<JunctionRebuildResult> {
  const { links, observations, canonicalIdOf, observationIdOf } = inputs;
  const observationById = new Map(observations.map((o) => [o.observation_id, o]));
  const filingDates = await loadFilingDates(observations.map((o) => o.accession_number));

  const addressGroups = new Map<string, JunctionAggregate>();
  const phoneGroups = new Map<string, JunctionAggregate>();
  const addressIds = new Map<string, { canonicalId: string; assoc: string }>();
  const phoneIds = new Map<string, { canonicalId: string; assoc: string }>();

  for (const link of links) {
    const observation = observationFor(observationById, observationIdOf(link));
    const filing_date = filingDateFor(filingDates, observation.accession_number);
    const canonicalId = canonicalIdOf(link);

    if (observation.raw_address_id) {
      const key = `${canonicalId}\x00${observation.raw_address_id}`;
      accumulate(addressGroups, key, filing_date);
      addressIds.set(key, { canonicalId, assoc: observation.raw_address_id });
    }
    if (observation.raw_phone_id) {
      const key = `${canonicalId}\x00${observation.raw_phone_id}`;
      accumulate(phoneGroups, key, filing_date);
      phoneIds.set(key, { canonicalId, assoc: observation.raw_phone_id });
    }
  }

  const replaceAll = async (
    repo: JunctionTargets["addressRepo"],
    groups: ReadonlyMap<string, JunctionAggregate>,
    ids: ReadonlyMap<string, { canonicalId: string; assoc: string }>,
    assocColumn: string
  ): Promise<void> => {
    await repo.deleteForResolverVersion(resolverVersion);
    for (const [key, aggregate] of groups) {
      const { canonicalId, assoc } = ids.get(key)!;
      await repo.replaceAggregate({
        [targets.idColumn]: canonicalId,
        [assocColumn]: assoc,
        resolver_version: resolverVersion,
        observation_count: aggregate.count,
        first_seen_at: aggregate.first_seen_at,
        last_seen_at: aggregate.last_seen_at,
      });
    }
  };

  await replaceAll(targets.addressRepo, addressGroups, addressIds, "address_hash_id");
  await replaceAll(targets.phoneRepo, phoneGroups, phoneIds, "international_number");

  return { addressRows: addressGroups.size, phoneRows: phoneGroups.size };
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
  const links: readonly PersonIdentityLink[] =
    await new PersonIdentityLinkRepo().listForResolverVersion(resolverVersion);
  const observations: readonly PersonObservation[] = await new PersonObservationRepo().listByIds(
    links.map((link) => link.observation_id)
  );
  return await rebuildJunctions(
    resolverVersion,
    {
      links,
      observations,
      canonicalIdOf: (link) => link.canonical_person_id,
      observationIdOf: (link) => link.observation_id,
    },
    {
      addressRepo: new CanonicalPersonAddressRepo(),
      phoneRepo: new CanonicalPersonPhoneRepo(),
      idColumn: "canonical_person_id",
    }
  );
}

/** Company counterpart of {@link rebuildPersonJunctions} — the exact mirror on `canonical_company_id`. */
export async function rebuildCompanyJunctions(
  resolverVersion: string
): Promise<JunctionRebuildResult> {
  const links: readonly CompanyIdentityLink[] =
    await new CompanyIdentityLinkRepo().listForResolverVersion(resolverVersion);
  const observations: readonly CompanyObservation[] = await new CompanyObservationRepo().listByIds(
    links.map((link) => link.observation_id)
  );
  return await rebuildJunctions(
    resolverVersion,
    {
      links,
      observations,
      canonicalIdOf: (link) => link.canonical_company_id,
      observationIdOf: (link) => link.observation_id,
    },
    {
      addressRepo: new CanonicalCompanyAddressRepo(),
      phoneRepo: new CanonicalCompanyPhoneRepo(),
      idColumn: "canonical_company_id",
    }
  );
}
