/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { canonicalTierDeps, type CanonicalEntityKind } from "./canonicalTier";

export type CanonicalAliasListTaskInput = {
  readonly kind: CanonicalEntityKind;
  readonly orphans?: boolean;
};

export type CanonicalAliasRow = {
  readonly alias_canonical_id: string;
  readonly target_canonical_id: string;
  readonly reason: string | null;
};

export type CanonicalAliasListTaskOutput = {
  readonly aliases: CanonicalAliasRow[];
};

/**
 * Lists canonical person/company aliases; with `orphans` set, only aliases
 * whose alias or target id no longer matches a canonical row.
 */
export class CanonicalAliasListTask extends Task<
  CanonicalAliasListTaskInput,
  CanonicalAliasListTaskOutput
> {
  static readonly type = "CanonicalAliasListTask";
  static readonly category = "SEC";
  static readonly title = "List canonical aliases";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: Type.Union([Type.Literal("person"), Type.Literal("company")]),
      orphans: Type.Optional(Type.Boolean()),
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

  async execute(input: CanonicalAliasListTaskInput): Promise<CanonicalAliasListTaskOutput> {
    const deps = canonicalTierDeps(input.kind);
    const aliasRepo = deps.aliases();
    const list = input.orphans
      ? await aliasRepo.listOrphans(await deps.listAllIds())
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
