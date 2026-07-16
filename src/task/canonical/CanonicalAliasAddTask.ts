/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { resolveCanonicalCompanyRef, resolveCanonicalPersonRef } from "../../cli/groups/canonical";
import { CanonicalCompanyAliasRepo } from "../../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalCompanyRepo } from "../../storage/canonical/CanonicalCompanyRepo";
import { CanonicalPersonAliasRepo } from "../../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalPersonRepo } from "../../storage/canonical/CanonicalPersonRepo";

export type CanonicalEntityKind = "person" | "company";

export type CanonicalAliasAddTaskInput = {
  readonly kind: CanonicalEntityKind;
  readonly from: string;
  readonly into: string;
  readonly reason?: string;
};

export type CanonicalAliasAddTaskOutput = {
  readonly aliasId: string;
  readonly targetId: string;
};

/**
 * Merges one canonical person/company into another by adding an alias row.
 * `from`/`into` accept a UUID or a display name (resolved via the canonical
 * reference resolvers).
 */
export class CanonicalAliasAddTask extends Task<
  CanonicalAliasAddTaskInput,
  CanonicalAliasAddTaskOutput
> {
  static readonly type = "CanonicalAliasAddTask";
  static readonly category = "SEC";
  static readonly title = "Add canonical alias";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: Type.Union([Type.Literal("person"), Type.Literal("company")]),
      from: Type.String(),
      into: Type.String(),
      reason: Type.Optional(Type.String()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      aliasId: Type.String(),
      targetId: Type.String(),
    });
  }

  async execute(input: CanonicalAliasAddTaskInput): Promise<CanonicalAliasAddTaskOutput> {
    if (input.kind === "person") {
      const canonRepo = new CanonicalPersonRepo();
      const fromId = await resolveCanonicalPersonRef(input.from, canonRepo);
      const intoId = await resolveCanonicalPersonRef(input.into, canonRepo);
      if (fromId === intoId) {
        throw new Error("cannot alias an id to itself");
      }
      const row = await new CanonicalPersonAliasRepo().add(
        fromId,
        intoId,
        input.reason ?? null,
        process.env.USER ?? null
      );
      return { aliasId: row.alias_canonical_id, targetId: row.target_canonical_id };
    }
    const canonRepo = new CanonicalCompanyRepo();
    const fromId = await resolveCanonicalCompanyRef(input.from, canonRepo);
    const intoId = await resolveCanonicalCompanyRef(input.into, canonRepo);
    if (fromId === intoId) {
      throw new Error("cannot alias an id to itself");
    }
    const row = await new CanonicalCompanyAliasRepo().add(
      fromId,
      intoId,
      input.reason ?? null,
      process.env.USER ?? null
    );
    return { aliasId: row.alias_canonical_id, targetId: row.target_canonical_id };
  }
}
