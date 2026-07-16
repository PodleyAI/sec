/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { familyTierDeps, type FamilyKind } from "./familyTier";

export type FamilyAliasAddTaskInput = {
  readonly family: FamilyKind;
  readonly fromName: string;
  readonly intoName: string;
  readonly reason?: string;
  readonly resolverVersion: string;
};

export type FamilyAliasAddTaskOutput = {
  readonly fromId: string;
  readonly intoId: string;
};

/**
 * Merges an AI-emitted variant family name into another for the sponsor /
 * underwriter family tiers. Both names must already exist as canonical family
 * rows at the given resolver version.
 */
export class FamilyAliasAddTask extends Task<FamilyAliasAddTaskInput, FamilyAliasAddTaskOutput> {
  static readonly type = "FamilyAliasAddTask";
  static readonly category = "SEC";
  static readonly title = "Add family alias";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      family: Type.Union([Type.Literal("sponsor"), Type.Literal("underwriter")]),
      fromName: Type.String(),
      intoName: Type.String(),
      reason: Type.Optional(Type.String()),
      resolverVersion: Type.String(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      fromId: Type.String(),
      intoId: Type.String(),
    });
  }

  async execute(input: FamilyAliasAddTaskInput): Promise<FamilyAliasAddTaskOutput> {
    const deps = familyTierDeps(input.family);
    const fromId = await deps.findIdByName(input.resolverVersion, input.fromName);
    const intoId = await deps.findIdByName(input.resolverVersion, input.intoName);
    if (!fromId || !intoId) {
      throw new Error("both family names must already exist");
    }
    await deps.aliases().add(fromId, intoId, input.reason ?? null, "cli");
    return { fromId, intoId };
  }
}
