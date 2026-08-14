/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { familyTierDeps, type FamilyKind } from "./familyTier";

export type FamilyAliasListTaskInput = {
  readonly family: FamilyKind;
  readonly orphans?: boolean;
  /** Scopes orphan detection; the plain listing is not version-scoped. */
  readonly resolverVersion?: string;
};

export type FamilyAliasRow = {
  readonly alias_canonical_id: string;
  readonly target_canonical_id: string;
  /**
   * Display names for the two sides, resolved at listing time; null when the
   * canonical family row is gone (an orphan). Carried because the ids alone
   * cannot be used to restate an alias: the re-key ceremony that makes an
   * operator export these is exactly what destroys the ids they reference.
   */
  readonly alias_name: string | null;
  readonly target_name: string | null;
  readonly reason: string | null;
};

export type FamilyAliasListTaskOutput = {
  readonly aliases: FamilyAliasRow[];
};

/**
 * Lists sponsor / underwriter family aliases; with `orphans` set, only aliases
 * whose alias or target id no longer matches a canonical family row at the
 * given resolver version.
 */
export class FamilyAliasListTask extends Task<FamilyAliasListTaskInput, FamilyAliasListTaskOutput> {
  static readonly type = "FamilyAliasListTask";
  static readonly category = "SEC";
  static readonly title = "List family aliases";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      family: Type.Union([Type.Literal("sponsor"), Type.Literal("underwriter")]),
      orphans: Type.Optional(Type.Boolean()),
      resolverVersion: Type.Optional(Type.String()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      aliases: Type.Array(
        Type.Object({
          alias_canonical_id: Type.String(),
          target_canonical_id: Type.String(),
          alias_name: Type.Union([Type.String(), Type.Null()]),
          target_name: Type.Union([Type.String(), Type.Null()]),
          reason: Type.Union([Type.String(), Type.Null()]),
        })
      ),
    });
  }

  async execute(input: FamilyAliasListTaskInput): Promise<FamilyAliasListTaskOutput> {
    const deps = familyTierDeps(input.family);
    const aliasRepo = deps.aliases();
    let list: Awaited<ReturnType<typeof aliasRepo.list>>;
    if (input.orphans) {
      if (input.resolverVersion === undefined) {
        throw new Error("orphan listing requires a resolverVersion");
      }
      list = await aliasRepo.listOrphans(
        new Set(await deps.listIdsForResolverVersion(input.resolverVersion))
      );
    } else {
      list = await aliasRepo.list();
    }
    const names = await deps.displayNames();
    return {
      aliases: list.map((a) => ({
        alias_canonical_id: a.alias_canonical_id,
        target_canonical_id: a.target_canonical_id,
        alias_name: names.get(a.alias_canonical_id) ?? null,
        target_name: names.get(a.target_canonical_id) ?? null,
        reason: a.reason,
      })),
    };
  }
}
