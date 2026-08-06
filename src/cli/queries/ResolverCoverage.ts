/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getResolverExtension, type ResolverId } from "../../resolver/resolverIds";

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
  // A registered kind may simply not provide a coverage closure (coverage is
  // optional on ResolverExtension). Report that plainly — do not mislabel it as
  // family-tier.
  if (!ext.coverage) {
    throw new Error(
      `coverage is not defined for resolver kind '${kind}' (no coverage model registered)`
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
