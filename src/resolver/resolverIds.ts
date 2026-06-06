/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export const RESOLVER_IDS = ["person", "company", "sponsor-family", "underwriter-family"] as const;
export type ResolverId = (typeof RESOLVER_IDS)[number];

/**
 * Resolver kinds that operate on the *family* tier (a name-only canonical +
 * membership model) rather than the person/company observation → identity-link
 * model. The observation-coverage query, the batch `resolve` command, and the
 * `drop-previous` purge ceremony are built around identity links and do **not**
 * yet support these kinds; callers must branch on this so a family kind is never
 * silently treated as the company tier.
 */
export const FAMILY_RESOLVER_IDS = ["sponsor-family", "underwriter-family"] as const;

/** True when `id` is a family-tier resolver kind (see {@link FAMILY_RESOLVER_IDS}). */
export function isFamilyResolverId(id: string): boolean {
  return (FAMILY_RESOLVER_IDS as readonly string[]).includes(id);
}

