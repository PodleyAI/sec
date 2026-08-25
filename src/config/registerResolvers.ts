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
import { SpacSponsorLinkRepo } from "../storage/canonical/SpacSponsorLinkRepo";
import { UnderwriterLinkRepo } from "../storage/canonical/UnderwriterLinkRepo";

/**
 * Register sec's built-in resolver kinds into the ResolverExtensionRegistry.
 * Called from the CLI bootstrap (and in tests that touch the version system).
 *
 * Centralizes the per-kind coverage + drop-previous logic in one place so
 * callers read it here instead of duplicating it per call site.
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
  // Coverage only. `dropPrevious` is deliberately left unregistered, so the
  // ceremony keeps refusing these kinds.
  //
  // On the person/company tier a purge is safe because identity links are
  // DERIVED: the observation rows survive it, so `sec resolve` rebuilds every
  // link the purge removed. The family tier has no such backstop — the link row
  // IS the attribution, not a projection of something that outlives it — and
  // `sec resolve` refuses family kinds, so nothing can rebuild what a purge
  // deletes. Recovery would mean re-extracting every affected S-1/424 and
  // re-paying the AI cost for all of them.
  //
  // The ceremony is symmetric in shape across the four kinds but not in
  // consequence, and the asymmetry is invisible at the call site: `drop-previous`
  // reads like the same routine cleanup whichever kind it is handed. Shipping
  // the read-only half now keeps that trap closed until a family `resolve`
  // exists to restore the rebuild invariant the other kinds rely on.
  registerResolverExtension({
    id: "sponsor-family",
    isFamily: true,
    coverage: async (version) => {
      const links = new SpacSponsorLinkRepo();
      const numerator = await links.count({ resolver_version: version });
      const denominator = await links.count();
      return { numerator, denominator };
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
  });
}
