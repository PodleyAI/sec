/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CanonicalCompanyAliasRepo } from "../../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalCompanyRepo } from "../../storage/canonical/CanonicalCompanyRepo";
import { CanonicalPersonAliasRepo } from "../../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalPersonRepo } from "../../storage/canonical/CanonicalPersonRepo";

/** The two canonical-entity tiers the parameterized alias tasks operate on. */
export type CanonicalEntityKind = "person" | "company";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a CLI-supplied canonical reference (UUID or display name) to a
 * canonical UUID. Bare strings are matched case-insensitively against the
 * canonical's display name (`display_first display_last` composite or
 * `display_last` alone for persons; `display_name` for companies). The CLI
 * docs invite operators to pass names, so we must not let raw strings flow
 * straight into UUID-typed columns.
 *
 * Throws when the input does not look like a UUID and no canonical row
 * matches (or more than one does).
 */
export async function resolveCanonicalPersonRef(
  input: string,
  repo: CanonicalPersonRepo
): Promise<string> {
  const trimmed = input.trim();
  if (UUID_RE.test(trimmed)) return trimmed;
  const all = await repo.listAll();
  const lower = trimmed.toLowerCase();
  const matches = all.filter((r) => {
    const composite = [r.display_first, r.display_last]
      .filter((s): s is string => Boolean(s))
      .join(" ")
      .toLowerCase();
    const lastOnly = (r.display_last ?? "").toLowerCase();
    return composite === lower || lastOnly === lower;
  });
  if (matches.length === 0) {
    throw new Error(`no canonical person matches '${trimmed}'`);
  }
  if (matches.length > 1) {
    throw new Error(
      `multiple canonical persons match '${trimmed}': ${matches
        .map((m) => m.canonical_person_id)
        .join(", ")}`
    );
  }
  return matches[0].canonical_person_id;
}

/** See {@link resolveCanonicalPersonRef}; companies match on `display_name`. */
export async function resolveCanonicalCompanyRef(
  input: string,
  repo: CanonicalCompanyRepo
): Promise<string> {
  const trimmed = input.trim();
  if (UUID_RE.test(trimmed)) return trimmed;
  const all = await repo.listAll();
  const lower = trimmed.toLowerCase();
  const matches = all.filter((r) => (r.display_name ?? "").toLowerCase() === lower);
  if (matches.length === 0) {
    throw new Error(`no canonical company matches '${trimmed}'`);
  }
  if (matches.length > 1) {
    throw new Error(
      `multiple canonical companies match '${trimmed}': ${matches
        .map((m) => m.canonical_company_id)
        .join(", ")}`
    );
  }
  return matches[0].canonical_company_id;
}

/** The alias-repo surface shared structurally by the person and company tiers. */
export interface CanonicalAliasRepoLike {
  add(
    alias_canonical_id: string,
    target_canonical_id: string,
    reason: string | null,
    created_by: string | null
  ): Promise<{ readonly alias_canonical_id: string; readonly target_canonical_id: string }>;
  remove(alias_canonical_id: string): Promise<void>;
  list(): Promise<
    ReadonlyArray<{
      readonly alias_canonical_id: string;
      readonly target_canonical_id: string;
      readonly reason: string | null;
    }>
  >;
  listOrphans(validIds: Set<string>): Promise<
    ReadonlyArray<{
      readonly alias_canonical_id: string;
      readonly target_canonical_id: string;
      readonly reason: string | null;
    }>
  >;
}

/**
 * Uniform access to a canonical entity tier's reference resolver, alias repo,
 * and id listing. The person and company tiers are structural mirrors that
 * differ only in repo classes and id column names, so the alias tasks resolve
 * this seam once and stay kind-agnostic (same shape as `familyTierDeps`).
 */
export interface CanonicalTierDeps {
  /** Resolves a UUID-or-display-name reference to a canonical id (throws on miss/ambiguity). */
  readonly resolveRef: (ref: string) => Promise<string>;
  readonly aliases: () => CanonicalAliasRepoLike;
  /** All canonical ids at this tier (orphan detection). */
  readonly listAllIds: () => Promise<Set<string>>;
  /**
   * Canonical id → display name, for every row at this tier.
   *
   * An alias row holds only UUIDs, and the re-key ceremony an operator exports
   * aliases BEFORE is exactly what destroys those ids — so a listing that
   * prints ids alone cannot be used to restore anything. The name is the part
   * that survives, and it is what the `alias` command takes back.
   */
  readonly displayNames: () => Promise<Map<string, string>>;
}

/** Display name for a canonical person: `first last`, or whichever half exists. */
function personDisplayName(row: {
  display_first: string | null;
  display_last: string | null;
}): string {
  return [row.display_first, row.display_last].filter((s): s is string => Boolean(s)).join(" ");
}

export function canonicalTierDeps(kind: CanonicalEntityKind): CanonicalTierDeps {
  if (kind === "person") {
    return {
      resolveRef: (ref) => resolveCanonicalPersonRef(ref, new CanonicalPersonRepo()),
      aliases: () => new CanonicalPersonAliasRepo(),
      listAllIds: async () =>
        new Set((await new CanonicalPersonRepo().listAll()).map((r) => r.canonical_person_id)),
      displayNames: async () =>
        new Map(
          (await new CanonicalPersonRepo().listAll())
            .map((r) => [r.canonical_person_id, personDisplayName(r)] as const)
            .filter(([, name]) => name !== "")
        ),
    };
  }
  return {
    resolveRef: (ref) => resolveCanonicalCompanyRef(ref, new CanonicalCompanyRepo()),
    aliases: () => new CanonicalCompanyAliasRepo(),
    listAllIds: async () =>
      new Set((await new CanonicalCompanyRepo().listAll()).map((r) => r.canonical_company_id)),
    displayNames: async () =>
      new Map(
        (await new CanonicalCompanyRepo().listAll())
          .map((r) => [r.canonical_company_id, r.display_name ?? ""] as const)
          .filter(([, name]) => name !== "")
      ),
  };
}
