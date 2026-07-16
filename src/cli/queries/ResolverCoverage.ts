/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PersonObservationRepo } from "../../storage/observation/PersonObservationRepo";
import { CompanyObservationRepo } from "../../storage/observation/CompanyObservationRepo";
import { PersonIdentityLinkRepo } from "../../storage/canonical/PersonIdentityLinkRepo";
import { CompanyIdentityLinkRepo } from "../../storage/canonical/CompanyIdentityLinkRepo";
import { FormDPortalAttributionRepo } from "../../storage/accredited-portal/FormDPortalAttributionRepo";
import { isFamilyResolverId, type ResolverId } from "../../resolver/resolverIds";

export interface ResolverCoverageResult {
  readonly kind: ResolverId;
  readonly resolver_version: string;
  readonly numerator: number;
  readonly denominator: number;
  readonly fraction: number;
}

export async function computeResolverCoverage(
  kind: ResolverId,
  resolver_version: string
): Promise<ResolverCoverageResult> {
  // Family-tier resolvers (sponsor-family / underwriter-family) have no
  // observation → identity-link coverage model; refuse rather than silently
  // reporting the company tier's coverage under a family-kind label.
  if (isFamilyResolverId(kind)) {
    throw new Error(
      `coverage is not defined for family resolver kind '${kind}' ` +
        `(family resolvers track membership, not observation identity-links)`
    );
  }
  // Portal attribution is derived, recomputable data: coverage is the share
  // of attribution rows written at the queried attributor version. A stale
  // fraction means `sec accredited-portal attribute --all` hasn't re-run
  // since the version changed.
  if (kind === "portal-attributor") {
    const attributionRepo = new FormDPortalAttributionRepo();
    const denom = await attributionRepo.countAll();
    const num = await attributionRepo.countAtVersion(resolver_version);
    return {
      kind,
      resolver_version,
      numerator: num,
      denominator: denom,
      fraction: denom === 0 ? 0 : num / denom,
    };
  }
  // Use the storage layer's COUNT path instead of materializing every row.
  // At Form D + Section 16 scale `listAll()` OOMs.
  if (kind === "person") {
    const obsRepo = new PersonObservationRepo();
    const linkRepo = new PersonIdentityLinkRepo();
    const denom = await obsRepo.count();
    const num = await linkRepo.count({ resolver_version });
    return {
      kind,
      resolver_version,
      numerator: num,
      denominator: denom,
      fraction: denom === 0 ? 0 : num / denom,
    };
  }
  const obsRepo = new CompanyObservationRepo();
  const linkRepo = new CompanyIdentityLinkRepo();
  const denom = await obsRepo.count();
  const num = await linkRepo.count({ resolver_version });
  return {
    kind,
    resolver_version,
    numerator: num,
    denominator: denom,
    fraction: denom === 0 ? 0 : num / denom,
  };
}
