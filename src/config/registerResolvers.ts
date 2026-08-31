/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { registerResolverExtension } from "../resolver/resolverExtensions";
import { registerIdentityLinkReap } from "../resolver/registerIdentityLinkReap";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import { CanonicalPersonAddressRepo } from "../storage/canonical/CanonicalPersonAddressRepo";
import { CanonicalPersonPhoneRepo } from "../storage/canonical/CanonicalPersonPhoneRepo";
import { CanonicalCompanyAddressRepo } from "../storage/canonical/CanonicalCompanyAddressRepo";
import { CanonicalCompanyPhoneRepo } from "../storage/canonical/CanonicalCompanyPhoneRepo";
import { CanonicalPersonRepo } from "../storage/canonical/CanonicalPersonRepo";
import { PersonRoleRepo } from "../storage/canonical/PersonRoleRepo";
import { CanonicalCompanyRepo } from "../storage/canonical/CanonicalCompanyRepo";

/**
 * Register sec's built-in resolver kinds into the ResolverExtensionRegistry.
 * Called from the CLI bootstrap (and in tests that touch the version system).
 *
 * Centralizes the per-kind coverage + drop-previous logic in one place so
 * callers read it here instead of duplicating it per call site.
 */
export function registerSecResolvers(): void {
  // The identity links still ship here, so this package contributes the hook
  // that deletes a reaped observation's. When the tier moves, this call moves
  // with it.
  registerIdentityLinkReap();
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
      await new PersonRoleRepo().deleteForResolverVersion(version);
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
}
