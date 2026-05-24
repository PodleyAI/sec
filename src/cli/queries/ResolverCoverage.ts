/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PersonObservationRepo } from "../../storage/observation/PersonObservationRepo";
import { CompanyObservationRepo } from "../../storage/observation/CompanyObservationRepo";
import { PersonIdentityLinkRepo } from "../../storage/canonical/PersonIdentityLinkRepo";
import { CompanyIdentityLinkRepo } from "../../storage/canonical/CompanyIdentityLinkRepo";
import type { ResolverId } from "../../resolver/resolverIds";

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
  if (kind === "person") {
    const obsRepo = new PersonObservationRepo();
    const linkRepo = new PersonIdentityLinkRepo();
    const denom = (await obsRepo.listAll()).length;
    const allLinks = await linkRepo.listAll();
    const num = allLinks.filter((l) => l.resolver_version === resolver_version).length;
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
  const denom = (await obsRepo.listAll()).length;
  const allLinks = await linkRepo.listAll();
  const num = allLinks.filter((l) => l.resolver_version === resolver_version).length;
  return {
    kind,
    resolver_version,
    numerator: num,
    denominator: denom,
    fraction: denom === 0 ? 0 : num / denom,
  };
}
