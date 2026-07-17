/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getResolverExtension, isFamilyResolverId, type ResolverId } from "../../resolver/resolverIds";

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
  const ext = getResolverExtension(kind);
  if (!ext) throw new Error(`unknown resolver kind '${kind}'`);
  // Family-tier resolvers (sponsor-family / underwriter-family) have no
  // observation → identity-link coverage model; refuse rather than silently
  // reporting the company tier's coverage under a family-kind label.
  if (isFamilyResolverId(kind) || !ext.coverage) {
    throw new Error(
      `coverage is not defined for family resolver kind '${kind}' ` +
        `(no observation identity-link coverage model registered)`
    );
  }
  const { numerator, denominator } = await ext.coverage(resolver_version);
  return {
    kind,
    resolver_version,
    numerator,
    denominator,
    fraction: denominator === 0 ? 0 : numerator / denominator,
  };
}
