/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { PersonObservationRepo } from "../../storage/observation/PersonObservationRepo";
import { CompanyObservationRepo } from "../../storage/observation/CompanyObservationRepo";
import { PersonIdentityLinkRepo } from "../../storage/canonical/PersonIdentityLinkRepo";
import { CompanyIdentityLinkRepo } from "../../storage/canonical/CompanyIdentityLinkRepo";
import { CanonicalPersonRepo } from "../../storage/canonical/CanonicalPersonRepo";
import { CanonicalCompanyRepo } from "../../storage/canonical/CanonicalCompanyRepo";
import { CanonicalPersonAliasRepo } from "../../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalCompanyAliasRepo } from "../../storage/canonical/CanonicalCompanyAliasRepo";
import { PersonResolver } from "../../resolver/PersonResolver";
import { CompanyResolver } from "../../resolver/CompanyResolver";
import { RESOLVER_IDS, type ResolverId } from "../../resolver/resolverIds";
import { isValidSemver } from "../../storage/versioning/VersionRegistry";

export function addResolveCommands(program: Command): void {
  const cmd = program.command("resolve");
  cmd
    .description("Re-resolve observations into identity-link rows at a target resolver version.")
    .requiredOption("--kind <kind>", "person | company")
    .requiredOption("--resolver-version <semver>", "target resolver semver")
    .option("--all", "process all observations of the kind", false)
    .action(async (opts: { kind: string; resolverVersion: string; all: boolean }) => {
      if (!RESOLVER_IDS.includes(opts.kind as ResolverId)) {
        console.error(`error: --kind must be one of ${RESOLVER_IDS.join("|")}`);
        process.exit(1);
      }
      if (!opts.all) {
        console.error("error: --all is required (no other mode supported in v1)");
        process.exit(1);
      }
      if (!isValidSemver(opts.resolverVersion)) {
        console.error(
          `error: --resolver-version must be a valid semver (got '${opts.resolverVersion}')`
        );
        process.exit(1);
      }

      if (opts.kind === "person") {
        const obsRepo = new PersonObservationRepo();
        const canonRepo = new CanonicalPersonRepo();
        const aliasRepo = new CanonicalPersonAliasRepo();
        const linkRepo = new PersonIdentityLinkRepo();
        const resolver = new PersonResolver({
          canonicalPersonRepo: canonRepo,
          canonicalPersonAliasRepo: aliasRepo,
          activeResolverVersion: opts.resolverVersion,
        });
        const all = await obsRepo.listAll();
        let count = 0;
        for (const obs of all) {
          const id = await resolver.resolve(obs);
          await linkRepo.upsert(obs.observation_id, opts.resolverVersion, id);
          count++;
        }
        console.log(`resolved ${count} person observation(s) at v${opts.resolverVersion}`);
      } else {
        const obsRepo = new CompanyObservationRepo();
        const canonRepo = new CanonicalCompanyRepo();
        const aliasRepo = new CanonicalCompanyAliasRepo();
        const linkRepo = new CompanyIdentityLinkRepo();
        const resolver = new CompanyResolver({
          canonicalCompanyRepo: canonRepo,
          canonicalCompanyAliasRepo: aliasRepo,
          activeResolverVersion: opts.resolverVersion,
        });
        const all = await obsRepo.listAll();
        let count = 0;
        for (const obs of all) {
          try {
            const id = await resolver.resolve(obs);
            await linkRepo.upsert(obs.observation_id, opts.resolverVersion, id);
            count++;
          } catch (e) {
            console.error(`skipping observation ${obs.observation_id}: ${(e as Error).message}`);
          }
        }
        console.log(`resolved ${count} company observation(s) at v${opts.resolverVersion}`);
      }
    });
}
