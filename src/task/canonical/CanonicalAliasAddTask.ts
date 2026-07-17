/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { canonicalTierDeps, type CanonicalEntityKind } from "./canonicalTier";

export type { CanonicalEntityKind } from "./canonicalTier";

export type CanonicalAliasAddTaskInput = {
  readonly kind: CanonicalEntityKind;
  readonly from: string;
  readonly into: string;
  readonly reason?: string;
};

export type CanonicalAliasAddTaskOutput = {
  readonly aliasId: string | null;
  readonly targetId: string | null;
  /**
   * Expected user-error (unresolvable/ambiguous reference, self-alias, alias
   * chain violation) as data rather than a throw, so the CLI renders it the
   * same on a TTY (where the workflow renderer hard-exits on thrown errors)
   * and when piped.
   */
  readonly error: string | null;
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
      aliasId: Type.Union([Type.String(), Type.Null()]),
      targetId: Type.Union([Type.String(), Type.Null()]),
      error: Type.Union([Type.String(), Type.Null()]),
    });
  }

  async execute(input: CanonicalAliasAddTaskInput): Promise<CanonicalAliasAddTaskOutput> {
    const deps = canonicalTierDeps(input.kind);
    try {
      const fromId = await deps.resolveRef(input.from);
      const intoId = await deps.resolveRef(input.into);
      if (fromId === intoId) {
        return { aliasId: null, targetId: null, error: "cannot alias an id to itself" };
      }
      const row = await deps
        .aliases()
        .add(fromId, intoId, input.reason ?? null, process.env.USER ?? null);
      return { aliasId: row.alias_canonical_id, targetId: row.target_canonical_id, error: null };
    } catch (e) {
      return { aliasId: null, targetId: null, error: (e as Error).message };
    }
  }
}
