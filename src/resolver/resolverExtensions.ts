/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Registry of resolver kinds for the unified `version resolver <kind>` command.
 * sec's own resolvers (person/company/families) register through this, as does
 * every downstream extension (e.g. embarc-data's portal-attributor). The
 * operations that vary by kind — coverage and version-scoped drop-previous —
 * are supplied per registration.
 */
export interface ResolverExtension {
  readonly id: string;
  /** Family-tier kinds use a membership model, not observation identity-links. */
  readonly isFamily?: boolean;
  /** Coverage numerator/denominator at a version; absent => coverage unsupported. */
  readonly coverage?: (version: string) => Promise<{ numerator: number; denominator: number }>;
  /** Version-scoped purge for drop-previous; absent => drop-previous unsupported. */
  readonly dropPrevious?: (version: string) => Promise<void>;
}

const REGISTRY = new Map<string, ResolverExtension>();

export function registerResolverExtension(ext: ResolverExtension): void {
  REGISTRY.set(ext.id, ext);
}

export function getResolverExtension(id: string): ResolverExtension | undefined {
  return REGISTRY.get(id);
}

export function listResolverIds(): readonly string[] {
  return [...REGISTRY.keys()];
}

export function isFamilyResolverId(id: string): boolean {
  return REGISTRY.get(id)?.isFamily === true;
}

/** Test hook: drop all registrations so a test starts from an empty registry. */
export function clearResolverExtensionsForTesting(): void {
  REGISTRY.clear();
}
