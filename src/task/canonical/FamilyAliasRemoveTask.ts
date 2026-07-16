/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { familyTierDeps, type FamilyKind } from "./familyTier";

export type FamilyAliasRemoveTaskInput = {
  readonly family: FamilyKind;
  readonly name: string;
  readonly resolverVersion: string;
};

export type FamilyAliasRemoveTaskOutput = {
  readonly removedId: string;
};

/** Removes the alias for a named sponsor / underwriter family. */
export class FamilyAliasRemoveTask extends Task<
  FamilyAliasRemoveTaskInput,
  FamilyAliasRemoveTaskOutput
> {
  static readonly type = "FamilyAliasRemoveTask";
  static readonly category = "SEC";
  static readonly title = "Remove family alias";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      family: Type.Union([Type.Literal("sponsor"), Type.Literal("underwriter")]),
      name: Type.String(),
      resolverVersion: Type.String(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      removedId: Type.String(),
    });
  }

  async execute(input: FamilyAliasRemoveTaskInput): Promise<FamilyAliasRemoveTaskOutput> {
    const deps = familyTierDeps(input.family);
    const familyId = await deps.findIdByName(input.resolverVersion, input.name);
    if (!familyId) {
      throw new Error(`no ${deps.kindLabel} found for '${input.name}'`);
    }
    await deps.aliases().remove(familyId);
    return { removedId: familyId };
  }
}
