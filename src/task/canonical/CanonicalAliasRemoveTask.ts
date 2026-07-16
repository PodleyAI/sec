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
import type { CanonicalEntityKind } from "./CanonicalAliasAddTask";

export type CanonicalAliasRemoveTaskInput = {
  readonly kind: CanonicalEntityKind;
  readonly from: string;
};

export type CanonicalAliasRemoveTaskOutput = {
  readonly removedId: string;
};

/**
 * Removes the alias for a canonical person/company. `from` accepts a UUID or a
 * display name (resolved via the canonical reference resolvers).
 */
export class CanonicalAliasRemoveTask extends Task<
  CanonicalAliasRemoveTaskInput,
  CanonicalAliasRemoveTaskOutput
> {
  static readonly type = "CanonicalAliasRemoveTask";
  static readonly category = "SEC";
  static readonly title = "Remove canonical alias";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: Type.Union([Type.Literal("person"), Type.Literal("company")]),
      from: Type.String(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      removedId: Type.String(),
    });
  }

  async execute(input: CanonicalAliasRemoveTaskInput): Promise<CanonicalAliasRemoveTaskOutput> {
    if (input.kind === "person") {
      const fromId = await resolveCanonicalPersonRef(input.from, new CanonicalPersonRepo());
      await new CanonicalPersonAliasRepo().remove(fromId);
      return { removedId: fromId };
    }
    const fromId = await resolveCanonicalCompanyRef(input.from, new CanonicalCompanyRepo());
    await new CanonicalCompanyAliasRepo().remove(fromId);
    return { removedId: fromId };
  }
}
