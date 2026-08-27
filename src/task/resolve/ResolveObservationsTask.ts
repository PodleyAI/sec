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
import { rebuildCompanyJunctions, rebuildPersonJunctions } from "../../resolver/rebuildJunctions";
import { rebuildPersonRoles } from "../../resolver/rebuildPersonRoles";

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
  /**
   * Also recompute the resolver version's `person_role` tenures. Person runs
   * only — asking for it on a company run is refused, since `person_role` is
   * keyed by the PERSON resolver version and a company pass writes nothing
   * that feeds it. Off by default even there because
   * {@link rebuildPersonRoles} purges the version's rows before re-deriving
   * them, and both of its inputs are columns older data does not carry: an
   * observation with no `role_scope` mints no tenure at all, and a filing with
   * no `role_roster_completeness` row re-opens every departure it had closed.
   * Over a corpus ingested before either column existed, the purge is a loss
   * the rebuild cannot make good. The junction projection carries no such
   * asymmetry and always runs.
   */
  readonly rebuildRoles?: boolean;
};

/** The derived projections this task recomputes from the identity links. */
export const REBUILD_KINDS = ["person-junctions", "company-junctions", "person-roles"] as const;
export type RebuildKind = (typeof REBUILD_KINDS)[number];

/** What one projection did, or what stopped it. */
export interface RebuildReport {
  readonly kind: RebuildKind;
  /** Rows the projection wrote at the resolver version. */
  readonly rows: number;
  /** The failure that ended this projection, or null. */
  readonly error: string | null;
}

/**
 * Runs one projection, isolating its failure the way {@link resolveAll}
 * isolates a row's. A rebuild raises on the first dangling join it meets — a
 * link whose observation is gone, an observation whose filing row is gone —
 * and one such row anywhere would otherwise take the whole run with it,
 * including the projections that would have succeeded. Both of those raises
 * land before the projection purges anything, so a failure reported for that
 * reason leaves its tables as they were; a storage error partway through the
 * re-insert is the case that does not.
 */
async function runRebuild(
  kind: RebuildKind,
  rebuild: () => Promise<number>
): Promise<RebuildReport> {
  try {
    return { kind, rows: await rebuild(), error: null };
  } catch (e) {
    const error = (e as Error).message;
    console.error(`skipping ${kind} rebuild: ${error}`);
    return { kind, rows: 0, error };
  }
}

/**
 * Recomputes the projections derived from the links this run just wrote, and
 * only those. The junctions are keyed by canonical id, so re-resolving
 * without them leaves rows keyed to the ids of the previous pass.
 *
 * Scoped to the kind that was resolved, because the resolver version is a
 * per-kind number that carries no per-kind name: `bootstrapComponentVersions`
 * seeds person and company alike at `1.0.0`, so on a default install the two
 * are the same string and an off-kind rebuild does not harmlessly find an
 * empty table — it finds the OTHER tier's live rows at that version and
 * recomputes them from links this run never touched. For `person_role`, whose
 * rebuild purges first, that is the other tier's tenures deleted by a command
 * about companies.
 */
async function rebuildProjections(input: ResolveObservationsTaskInput): Promise<RebuildReport[]> {
  const version = input.resolverVersion;
  switch (input.kind) {
    case "company":
      return [
        await runRebuild("company-junctions", async () => {
          const result = await rebuildCompanyJunctions(version);
          return result.addressRows + result.phoneRows;
        }),
      ];
    case "person": {
      const reports = [
        await runRebuild("person-junctions", async () => {
          const result = await rebuildPersonJunctions(version);
          return result.addressRows + result.phoneRows;
        }),
      ];
      if (input.rebuildRoles) {
        // Said before the deletion rather than after it, and by the task rather
        // than by one front-end, so every caller sees what it is about to spend.
        console.warn(
          `rebuilding person_role at v${version}: every tenure at this version is deleted and ` +
            `re-derived from the observations. An observation with no person_observation.role_scope ` +
            `mints NO tenure, and a tenure closed by a filing with no role_roster_completeness row ` +
            `re-opens. Filings extracted before those columns existed carry neither — re-extract ` +
            `them first, or this deletes tenures it cannot re-derive.`
        );
        reports.push(
          await runRebuild("person-roles", async () => (await rebuildPersonRoles(version)).rows)
        );
      }
      return reports;
    }
    default: {
      // Exhaustiveness guard, and the reason this is a switch and not an
      // if/else: an else branch hands an unlisted kind the PERSON
      // projections, rebuilding person junctions off links it never wrote.
      const _exhaustive: never = input.kind;
      throw new Error(`Unhandled resolver kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Shared per-kind loop: resolve each observation and write its identity link,
 * isolating per-row failures (logged to stderr) so one bad row can't abort the
 * whole batch.
 */
async function resolveAll<Obs extends { readonly observation_id: number }>(
  observations: readonly Obs[],
  resolveOne: (obs: Obs) => Promise<string>,
  writeLink: (observationId: number, canonicalId: string) => Promise<unknown>
): Promise<Omit<ResolveObservationsTaskOutput, "renormalized" | "rebuilds">> {
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
  /**
   * One entry per projection recomputed from the new links, in the order they
   * ran. `person-roles` is present only when `rebuildRoles` asked for it.
   */
  readonly rebuilds: RebuildReport[];
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
 * target resolver version, then recomputes the projections derived from those
 * links. Per-observation failures are isolated (logged to stderr) so one bad
 * row cannot abort the whole batch, and each projection is isolated the same
 * way so one that raises does not take the others with it.
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
      rebuildRoles: Type.Optional(Type.Boolean()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      count: Type.Number(),
      skipped: Type.Number(),
      renormalized: Type.Number(),
      rebuilds: Type.Array(
        Type.Object({
          kind: Type.Union(REBUILD_KINDS.map((kind) => Type.Literal(kind))),
          rows: Type.Number(),
          error: Type.Union([Type.String(), Type.Null()]),
        })
      ),
    });
  }

  async execute(input: ResolveObservationsTaskInput): Promise<ResolveObservationsTaskOutput> {
    // Refused rather than ignored: `person_role` belongs to the person tier,
    // and a caller that asked a company pass to rebuild it is working from a
    // model of the run that is wrong. Raising here costs nothing — the flag
    // had no honest effect on this kind — and the alternative reading of it
    // deletes person tenures.
    if (input.kind !== "person" && input.rebuildRoles) {
      throw new Error(
        `rebuildRoles applies to kind 'person' only: person_role is keyed by the person ` +
          `resolver version, and a '${input.kind}' pass writes no link that feeds it`
      );
    }
    switch (input.kind) {
      case "person": {
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
        const resolved = await resolveAll(
          await observations.listAll(),
          (obs) => resolver.resolve(obs),
          (obsId, id) => linkRepo.upsert(obsId, input.resolverVersion, id)
        );
        return { ...resolved, renormalized, rebuilds: await rebuildProjections(input) };
      }
      case "company": {
        const observations = new CompanyObservationRepo();
        const renormalized = input.renormalize ? await renormalizeCompanies(observations) : 0;
        const resolver = new CompanyResolver({
          canonicalCompanyRepo: new CanonicalCompanyRepo(),
          canonicalCompanyAliasRepo: new CanonicalCompanyAliasRepo(),
          activeResolverVersion: input.resolverVersion,
        });
        const linkRepo = new CompanyIdentityLinkRepo();
        const resolved = await resolveAll(
          await observations.listAll(),
          (obs) => resolver.resolve(obs),
          (obsId, id) => linkRepo.upsert(obsId, input.resolverVersion, id)
        );
        return { ...resolved, renormalized, rebuilds: await rebuildProjections(input) };
      }
      default: {
        // Exhaustiveness guard. As if/else, this dispatcher and
        // {@link rebuildProjections} lean OPPOSITE ways — company here, person
        // there — so an unlisted kind resolves one tier and then rebuilds the
        // other's junctions. Naming every kind makes a third one a compile
        // error in both places instead.
        const _exhaustive: never = input.kind;
        throw new Error(`Unhandled resolver kind: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
