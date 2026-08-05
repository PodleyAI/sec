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
import { PersonRoleRepo } from "../storage/canonical/PersonRoleRepo";
import { CanonicalCompanyRepo } from "../storage/canonical/CanonicalCompanyRepo";
import { CanonicalSponsorFamilyRepo } from "../storage/canonical/CanonicalSponsorFamilyRepo";
import { CanonicalUnderwriterFamilyRepo } from "../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { SponsorFamilyMembershipRepo } from "../storage/canonical/SponsorFamilyMembershipRepo";
import { UnderwriterFamilyMembershipRepo } from "../storage/canonical/UnderwriterFamilyMembershipRepo";
import { SpacSponsorLinkRepo } from "../storage/canonical/SpacSponsorLinkRepo";
import { UnderwriterLinkRepo } from "../storage/canonical/UnderwriterLinkRepo";

/**
 * Register sec's built-in resolver kinds into the ResolverExtensionRegistry.
 * Called from the CLI bootstrap (and in tests that touch the version system).
 *
 * The per-kind coverage + drop-previous logic moves here from the previously
 * hardcoded branches in `cli/queries/ResolverCoverage.ts` and
 * `storage/versioning/ceremonies.ts`.
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
  // Family tiers have no observation → identity-link table: their per-filing
  // fact IS the link row (spac_sponsor_link / underwriter_link), keyed by
  // (accession, extractor, observation_index) with the resolver version as a
  // plain column. So one row exists per family-tier fact, carrying whichever
  // version last wrote it, and coverage is the share of those rows already
  // re-attributed at the target version.
  //
  // The purge is deliberately confined to the three version-scoped family
  // tables. It must never reach the company tier the family sits above:
  // membership and link rows reference `canonical_company_id`, but those
  // companies belong to the `company` resolver's own version line and are
  // dropped only by its ceremony. Family aliases and family descriptions are
  // not version-scoped either, so they survive — matching the person/company
  // rule that operator-installed aliases outlive a resolver version.
  registerResolverExtension({
    id: "sponsor-family",
    isFamily: true,
    coverage: async (version) => {
      const links = new SpacSponsorLinkRepo();
      const numerator = await links.count({ resolver_version: version });
      const denominator = await links.count();
      return { numerator, denominator };
    },
    dropPrevious: async (version) => {
      await new SpacSponsorLinkRepo().deleteForResolverVersion(version);
      await new SponsorFamilyMembershipRepo().deleteForResolverVersion(version);
      await new CanonicalSponsorFamilyRepo().deleteForResolverVersion(version);
    },
  });
  registerResolverExtension({
    id: "underwriter-family",
    isFamily: true,
    coverage: async (version) => {
      const links = new UnderwriterLinkRepo();
      const numerator = await links.count({ resolver_version: version });
      const denominator = await links.count();
      return { numerator, denominator };
    },
    dropPrevious: async (version) => {
      await new UnderwriterLinkRepo().deleteForResolverVersion(version);
      await new UnderwriterFamilyMembershipRepo().deleteForResolverVersion(version);
      await new CanonicalUnderwriterFamilyRepo().deleteForResolverVersion(version);
    },
  });
}
