/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { canonicalTierDeps, type CanonicalEntityKind } from "./canonicalTier";

export type CanonicalAliasRemoveTaskInput = {
  readonly kind: CanonicalEntityKind;
  readonly from: string;
};

export type CanonicalAliasRemoveTaskOutput = {
  readonly removedId: string | null;
  /** Expected reference-resolution failure as data; see CanonicalAliasAddTask. */
  readonly error: string | null;
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
      removedId: Type.Union([Type.String(), Type.Null()]),
      error: Type.Union([Type.String(), Type.Null()]),
    });
  }

  async execute(input: CanonicalAliasRemoveTaskInput): Promise<CanonicalAliasRemoveTaskOutput> {
    const deps = canonicalTierDeps(input.kind);
    let fromId: string;
    try {
      fromId = await deps.resolveRef(input.from);
    } catch (e) {
      return { removedId: null, error: (e as Error).message };
    }
    await deps.aliases().remove(fromId);
    return { removedId: fromId, error: null };
  }
}
