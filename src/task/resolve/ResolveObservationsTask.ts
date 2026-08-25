/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { normalizePersonNameParts } from "../../resolver/EntityObserver";
import { CompanyResolver } from "../../resolver/CompanyResolver";
import { PersonResolver } from "../../resolver/PersonResolver";
import { CanonicalCompanyAliasRepo } from "../../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalCompanyRepo } from "../../storage/canonical/CanonicalCompanyRepo";
import { CanonicalPersonAliasRepo } from "../../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalPersonRepo } from "../../storage/canonical/CanonicalPersonRepo";
import { CompanyIdentityLinkRepo } from "../../storage/canonical/CompanyIdentityLinkRepo";
import { PersonIdentityLinkRepo } from "../../storage/canonical/PersonIdentityLinkRepo";
import { CompanyObservationRepo } from "../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../storage/observation/PersonObservationRepo";
import { normalizeCompanyName } from "../../storage/company/CompanyNormalization";

/**
 * The resolver kinds this batch pass implements. A kind qualifies only when its
 * resolution input is fully persisted on the observation row, so the resolver
 * can be re-run from storage alone.
 */
export const BATCH_RESOLVABLE_KINDS = ["person", "company"] as const;
export type BatchResolvableKind = (typeof BATCH_RESOLVABLE_KINDS)[number];

export function isBatchResolvableKind(kind: string): kind is BatchResolvableKind {
  return (BATCH_RESOLVABLE_KINDS as readonly string[]).includes(kind);
}

export type ResolveObservationsTaskInput = {
  readonly kind: BatchResolvableKind;
  readonly resolverVersion: string;
  /**
   * Recompute each observation's derived identity columns from the name as
   * filed before resolving. See {@link renormalizePersons}.
   */
  readonly renormalize?: boolean;
};

/**
 * Shared per-kind loop: resolve each observation and write its identity link,
 * isolating per-row failures (logged to stderr) so one bad row can't abort the
 * whole batch.
 */
async function resolveAll<Obs extends { readonly observation_id: number }>(
  observations: readonly Obs[],
  resolveOne: (obs: Obs) => Promise<string>,
  writeLink: (observationId: number, canonicalId: string) => Promise<unknown>
): Promise<Omit<ResolveObservationsTaskOutput, "renormalized">> {
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

export type ResolveObservationsTaskOutput = {
  readonly count: number;
  /** Observations skipped by the per-row failure isolation (also logged to stderr). */
  readonly skipped: number;
  /** Rows whose derived identity columns changed under `renormalize`. */
  readonly renormalized: number;
};

/**
 * Recomputes `normalized_first/middle/last/suffix` from the name as filed.
 *
 * Without this, a change to `normalizePerson` reaches the database only by
 * re-extracting every person-observing filing: the columns are written on the
 * extraction path, and this task otherwise resolves FROM them rather than
 * recomputing them. A normalizer change would otherwise cost a full
 * re-extraction and its AI bill per filing.
 *
 * Off by default. A resolve pass that silently rewrote its own input would give
 * the operator who asked to re-partition a generation something they did not
 * ask for.
 */
async function renormalizePersons(repo: PersonObservationRepo): Promise<number> {
  let changed = 0;
  for (const row of await repo.listAll()) {
    const { normalized } = normalizePersonNameParts(row);
    const next = {
      normalized_first: normalized?.first ?? null,
      normalized_middle: normalized?.middle ?? null,
      normalized_last: normalized?.last ?? null,
      normalized_suffix: normalized?.suffix ?? null,
    };
    const same =
      next.normalized_first === row.normalized_first &&
      next.normalized_middle === row.normalized_middle &&
      next.normalized_last === row.normalized_last &&
      next.normalized_suffix === row.normalized_suffix;
    if (same) continue;
    await repo.updateNormalizedParts(row, next);
    changed++;
  }
  return changed;
}

/** The company twin of {@link renormalizePersons}, over `normalized_name`. */
async function renormalizeCompanies(repo: CompanyObservationRepo): Promise<number> {
  let changed = 0;
  for (const row of await repo.listAll()) {
    const next = row.name ? normalizeCompanyName(row.name) : null;
    if (next === row.normalized_name) continue;
    await repo.updateNormalizedName(row, next);
    changed++;
  }
  return changed;
}

/**
 * Re-resolves every observation of a kind into identity-link rows at the
 * target resolver version. Per-observation failures are isolated (logged to
 * stderr) so one bad row cannot abort the whole batch.
 */
export class ResolveObservationsTask extends Task<
  ResolveObservationsTaskInput,
  ResolveObservationsTaskOutput
> {
  static readonly type = "ResolveObservationsTask";
  static readonly category = "SEC";
  static readonly title = "Resolve observations";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: Type.Union([Type.Literal("person"), Type.Literal("company")]),
      resolverVersion: Type.String(),
      renormalize: Type.Optional(Type.Boolean()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      count: Type.Number(),
      skipped: Type.Number(),
      renormalized: Type.Number(),
    });
  }

  async execute(input: ResolveObservationsTaskInput): Promise<ResolveObservationsTaskOutput> {
    if (input.kind === "person") {
      const observations = new PersonObservationRepo();
      // Before resolving, not after: the resolver matches on these columns, so
      // recomputing them afterwards would leave the links keyed to the previous
      // generation and report a coverage the data does not have.
      const renormalized = input.renormalize ? await renormalizePersons(observations) : 0;
      const resolver = new PersonResolver({
        canonicalPersonRepo: new CanonicalPersonRepo(),
        canonicalPersonAliasRepo: new CanonicalPersonAliasRepo(),
        activeResolverVersion: input.resolverVersion,
      });
      const linkRepo = new PersonIdentityLinkRepo();
      return {
        ...(await resolveAll(
          await observations.listAll(),
          (obs) => resolver.resolve(obs),
          (obsId, id) => linkRepo.upsert(obsId, input.resolverVersion, id)
        )),
        renormalized,
      };
    }
    const observations = new CompanyObservationRepo();
    const renormalized = input.renormalize ? await renormalizeCompanies(observations) : 0;
    const resolver = new CompanyResolver({
      canonicalCompanyRepo: new CanonicalCompanyRepo(),
      canonicalCompanyAliasRepo: new CanonicalCompanyAliasRepo(),
      activeResolverVersion: input.resolverVersion,
    });
    const linkRepo = new CompanyIdentityLinkRepo();
    return {
      ...(await resolveAll(
        await observations.listAll(),
        (obs) => resolver.resolve(obs),
        (obsId, id) => linkRepo.upsert(obsId, input.resolverVersion, id)
      )),
      renormalized,
    };
  }
}
