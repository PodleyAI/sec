/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { FamilyDescriptionRepo } from "../../storage/canonical/FamilyDescriptionRepo";
import type { FamilyDescriptionKind } from "../../storage/canonical/FamilyDescriptionSchema";

export type SetFamilyDescriptionTaskInput = {
  readonly kind: FamilyDescriptionKind;
  readonly normalizedName: string;
  readonly text: string;
};

export type SetFamilyDescriptionTaskOutput = {
  readonly described: boolean;
};

/**
 * Writes the editorial description for a sponsor / underwriter family, keyed by
 * `(family_kind, normalized_name)` — callers pass the SAME normalized name the
 * resolvers use so the description lines up with the resolved family.
 */
export class SetFamilyDescriptionTask extends Task<
  SetFamilyDescriptionTaskInput,
  SetFamilyDescriptionTaskOutput
> {
  static readonly type = "SetFamilyDescriptionTask";
  static readonly category = "SEC";
  static readonly title = "Set family description";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: Type.String(),
      normalizedName: Type.String(),
      text: Type.String(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      described: Type.Boolean(),
    });
  }

  async execute(input: SetFamilyDescriptionTaskInput): Promise<SetFamilyDescriptionTaskOutput> {
    await new FamilyDescriptionRepo().setDescription(input.kind, input.normalizedName, input.text);
    return { described: true };
  }
}
