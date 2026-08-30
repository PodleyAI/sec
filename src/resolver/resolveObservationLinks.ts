/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CanonicalCompanyAliasRepo } from "../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalCompanyRepo } from "../storage/canonical/CanonicalCompanyRepo";
import { CanonicalPersonAliasRepo } from "../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalPersonRepo } from "../storage/canonical/CanonicalPersonRepo";
import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import type { CompanyObservation } from "../storage/observation/CompanyObservationSchema";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import type { PersonObservation } from "../storage/observation/PersonObservationSchema";
import { CompanyResolver } from "./CompanyResolver";
import { PersonResolver } from "./PersonResolver";

/** How one resolve pass went, whatever scope it ran over. */
export interface ObservationResolveResult {
  readonly count: number;
  /** Observations skipped by the per-row failure isolation (also logged to stderr). */
  readonly skipped: number;
}

/**
 * Resolve each observation and write its identity link, isolating per-row
 * failures (logged to stderr) so one bad row cannot abort the rest.
 */
async function resolveEach<Obs extends { readonly observation_id: number }>(
  observations: readonly Obs[],
  resolveOne: (obs: Obs) => Promise<string>,
  writeLink: (observationId: number, canonicalId: string) => Promise<unknown>
): Promise<ObservationResolveResult> {
  let count = 0;
  let skipped = 0;
  for (const obs of observations) {
    try {
      const id = await resolveOne(obs);
      await writeLink(obs.observation_id, id);
      count++;
    } catch (e) {
      skipped++;
      console.error(`skipping observation ${obs.observation_id}: ${(e as Error).message}`);
    }
  }
  return { count, skipped };
}

/**
 * Resolves person observations into identity links at `resolverVersion`.
 *
 * Same-accession variants are made adjacent first, so the resolver can compare
 * a whole filing while keeping its candidate cache bounded. A one-accession
 * scope satisfies that ordering by construction, which is what lets the same
 * function serve both the corpus pass and a single filing.
 */
export async function resolvePersonObservations(
  rows: readonly PersonObservation[],
  resolverVersion: string
): Promise<ObservationResolveResult> {
  const resolver = new PersonResolver({
    canonicalPersonRepo: new CanonicalPersonRepo(),
    canonicalPersonAliasRepo: new CanonicalPersonAliasRepo(),
    activeResolverVersion: resolverVersion,
  });
  const linkRepo = new PersonIdentityLinkRepo();
  const sorted = [...rows].sort(
    (a, b) =>
      a.accession_number.localeCompare(b.accession_number) ||
      a.observation_index - b.observation_index
  );
  return await resolveEach(
    sorted,
    (obs) => resolver.resolve(obs),
    (obsId, id) => linkRepo.upsert(obsId, resolverVersion, id)
  );
}

/** Resolves company observations into identity links at `resolverVersion`. */
export async function resolveCompanyObservations(
  rows: readonly CompanyObservation[],
  resolverVersion: string
): Promise<ObservationResolveResult> {
  const resolver = new CompanyResolver({
    canonicalCompanyRepo: new CanonicalCompanyRepo(),
    canonicalCompanyAliasRepo: new CanonicalCompanyAliasRepo(),
    activeResolverVersion: resolverVersion,
  });
  const linkRepo = new CompanyIdentityLinkRepo();
  return await resolveEach(
    rows,
    (obs) => resolver.resolve(obs),
    (obsId, id) => linkRepo.upsert(obsId, resolverVersion, id)
  );
}

/**
 * Resolves the observations ONE filing left behind, and nothing else.
 *
 * A form module that must read a canonical id back — to key a projection of
 * its own on, or to copy a canonical column onto a row it is writing — needs
 * one to exist before it returns, and a corpus-wide pass per filing is not an
 * option. This gives it the same resolver over a one-filing scope, so there is
 * one resolution implementation rather than an eager one and a batch one that
 * can disagree.
 *
 * It writes identity links only. Everything derived FROM the links —
 * tenures, junction counts — stays a projection recomputed from stored
 * evidence, which is what keeps a replay order-independent.
 */
export async function resolveObservationsForAccession(args: {
  readonly kind: "person" | "company";
  readonly accession_number: string;
  readonly resolverVersion: string;
}): Promise<ObservationResolveResult> {
  if (args.kind === "person") {
    const rows = await new PersonObservationRepo().listByAccession(args.accession_number);
    return await resolvePersonObservations(rows, args.resolverVersion);
  }
  const rows = await new CompanyObservationRepo().listByAccession(args.accession_number);
  return await resolveCompanyObservations(rows, args.resolverVersion);
}
