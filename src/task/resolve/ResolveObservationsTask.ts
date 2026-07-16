/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
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

export type ResolveObservationsTaskInput = {
  readonly kind: "person" | "company";
  readonly resolverVersion: string;
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
): Promise<ResolveObservationsTaskOutput> {
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
};

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
    });
  }

  public static outputSchema() {
    return Type.Object({
      count: Type.Number(),
      skipped: Type.Number(),
    });
  }

  async execute(input: ResolveObservationsTaskInput): Promise<ResolveObservationsTaskOutput> {
    if (input.kind === "person") {
      const resolver = new PersonResolver({
        canonicalPersonRepo: new CanonicalPersonRepo(),
        canonicalPersonAliasRepo: new CanonicalPersonAliasRepo(),
        activeResolverVersion: input.resolverVersion,
      });
      const linkRepo = new PersonIdentityLinkRepo();
      return resolveAll(
        await new PersonObservationRepo().listAll(),
        (obs) => resolver.resolve(obs),
        (obsId, id) => linkRepo.upsert(obsId, input.resolverVersion, id)
      );
    }
    const resolver = new CompanyResolver({
      canonicalCompanyRepo: new CanonicalCompanyRepo(),
      canonicalCompanyAliasRepo: new CanonicalCompanyAliasRepo(),
      activeResolverVersion: input.resolverVersion,
    });
    const linkRepo = new CompanyIdentityLinkRepo();
    return resolveAll(
      await new CompanyObservationRepo().listAll(),
      (obs) => resolver.resolve(obs),
      (obsId, id) => linkRepo.upsert(obsId, input.resolverVersion, id)
    );
  }
}
