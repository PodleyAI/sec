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
  readonly resolverVersion: string;
};

export type FamilyAliasRow = {
  readonly alias_canonical_id: string;
  readonly target_canonical_id: string;
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
      resolverVersion: Type.String(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      aliases: Type.Array(
        Type.Object({
          alias_canonical_id: Type.String(),
          target_canonical_id: Type.String(),
          reason: Type.Union([Type.String(), Type.Null()]),
        })
      ),
    });
  }

  async execute(input: FamilyAliasListTaskInput): Promise<FamilyAliasListTaskOutput> {
    const deps = familyTierDeps(input.family);
    const aliasRepo = deps.aliases();
    const list = input.orphans
      ? await aliasRepo.listOrphans(
          new Set(await deps.listIdsForResolverVersion(input.resolverVersion))
        )
      : await aliasRepo.list();
    return {
      aliases: list.map((a) => ({
        alias_canonical_id: a.alias_canonical_id,
        target_canonical_id: a.target_canonical_id,
        reason: a.reason,
      })),
    };
  }
}
