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

export type ResolveObservationsTaskOutput = {
  readonly count: number;
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
    });
  }

  async execute(input: ResolveObservationsTaskInput): Promise<ResolveObservationsTaskOutput> {
    if (input.kind === "person") {
      const obsRepo = new PersonObservationRepo();
      const canonRepo = new CanonicalPersonRepo();
      const aliasRepo = new CanonicalPersonAliasRepo();
      const linkRepo = new PersonIdentityLinkRepo();
      const resolver = new PersonResolver({
        canonicalPersonRepo: canonRepo,
        canonicalPersonAliasRepo: aliasRepo,
        activeResolverVersion: input.resolverVersion,
      });
      const all = await obsRepo.listAll();
      let count = 0;
      for (const obs of all) {
        // Isolate per-observation failures so one bad row can't abort the
        // whole batch (mirrors the company branch below).
        try {
          const id = await resolver.resolve(obs);
          await linkRepo.upsert(obs.observation_id, input.resolverVersion, id);
          count++;
        } catch (e) {
          console.error(`skipping observation ${obs.observation_id}: ${(e as Error).message}`);
        }
      }
      return { count };
    }
    const obsRepo = new CompanyObservationRepo();
    const canonRepo = new CanonicalCompanyRepo();
    const aliasRepo = new CanonicalCompanyAliasRepo();
    const linkRepo = new CompanyIdentityLinkRepo();
    const resolver = new CompanyResolver({
      canonicalCompanyRepo: canonRepo,
      canonicalCompanyAliasRepo: aliasRepo,
      activeResolverVersion: input.resolverVersion,
    });
    const all = await obsRepo.listAll();
    let count = 0;
    for (const obs of all) {
      try {
        const id = await resolver.resolve(obs);
        await linkRepo.upsert(obs.observation_id, input.resolverVersion, id);
        count++;
      } catch (e) {
        console.error(`skipping observation ${obs.observation_id}: ${(e as Error).message}`);
      }
    }
    return { count };
  }
}
