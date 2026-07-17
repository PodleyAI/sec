/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { registerResolverExtension } from "../resolver/resolverExtensions";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import { CanonicalPersonAddressRepo } from "../storage/canonical/CanonicalPersonAddressRepo";
import { CanonicalPersonPhoneRepo } from "../storage/canonical/CanonicalPersonPhoneRepo";
import { CanonicalCompanyAddressRepo } from "../storage/canonical/CanonicalCompanyAddressRepo";
import { CanonicalCompanyPhoneRepo } from "../storage/canonical/CanonicalCompanyPhoneRepo";
import { CanonicalPersonRepo } from "../storage/canonical/CanonicalPersonRepo";
import { CanonicalCompanyRepo } from "../storage/canonical/CanonicalCompanyRepo";
import { FormDPortalAttributionRepo } from "../storage/accredited-portal/FormDPortalAttributionRepo";

/**
 * Register sec's built-in resolver kinds into the ResolverExtensionRegistry.
 * Called from the CLI bootstrap (and in tests that touch the version system).
 *
 * The per-kind coverage + drop-previous logic moves here from the previously
 * hardcoded branches in `cli/queries/ResolverCoverage.ts` and
 * `storage/versioning/ceremonies.ts`.
 *
 * NOTE: `portal-attributor` is registered here only until the accredited-portal
 * feature is extracted to embarc-data, which then registers it from its own
 * bootstrap.
 */
export function registerSecResolvers(): void {
  registerResolverExtension({
    id: "person",
    coverage: async (version) => {
      const denominator = await new PersonObservationRepo().count();
      const numerator = await new PersonIdentityLinkRepo().count({ resolver_version: version });
      return { numerator, denominator };
    },
    dropPrevious: async (version) => {
      await new PersonIdentityLinkRepo().deleteForResolverVersion(version);
      await new CanonicalPersonAddressRepo().deleteForResolverVersion(version);
      await new CanonicalPersonPhoneRepo().deleteForResolverVersion(version);
      await new CanonicalPersonRepo().deleteForResolverVersion(version);
    },
  });
  registerResolverExtension({
    id: "company",
    coverage: async (version) => {
      const denominator = await new CompanyObservationRepo().count();
      const numerator = await new CompanyIdentityLinkRepo().count({ resolver_version: version });
      return { numerator, denominator };
    },
    dropPrevious: async (version) => {
      await new CompanyIdentityLinkRepo().deleteForResolverVersion(version);
      await new CanonicalCompanyAddressRepo().deleteForResolverVersion(version);
      await new CanonicalCompanyPhoneRepo().deleteForResolverVersion(version);
      await new CanonicalCompanyRepo().deleteForResolverVersion(version);
    },
  });
  registerResolverExtension({ id: "sponsor-family", isFamily: true });
  registerResolverExtension({ id: "underwriter-family", isFamily: true });
  // TEMPORARY (removed when the portal feature moves to embarc-data):
  registerResolverExtension({
    id: "portal-attributor",
    coverage: async (version) => {
      const repo = new FormDPortalAttributionRepo();
      return { numerator: await repo.countAtVersion(version), denominator: await repo.countAll() };
    },
    dropPrevious: async (version) => {
      await new FormDPortalAttributionRepo().deleteForAttributorVersion(version);
    },
  });
}
