/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { CanonicalCompanyAliasRepo } from "../../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalCompanyRepo } from "../../storage/canonical/CanonicalCompanyRepo";
import { CanonicalPersonAliasRepo } from "../../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalPersonRepo } from "../../storage/canonical/CanonicalPersonRepo";
import type { CanonicalEntityKind } from "./CanonicalAliasAddTask";

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
    if (input.kind === "person") {
      const aliasRepo = new CanonicalPersonAliasRepo();
      const list = input.orphans
        ? await aliasRepo.listOrphans(
            new Set((await new CanonicalPersonRepo().listAll()).map((r) => r.canonical_person_id))
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
    const aliasRepo = new CanonicalCompanyAliasRepo();
    const list = input.orphans
      ? await aliasRepo.listOrphans(
          new Set((await new CanonicalCompanyRepo().listAll()).map((r) => r.canonical_company_id))
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
