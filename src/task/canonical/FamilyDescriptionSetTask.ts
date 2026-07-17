/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { FamilyDescriptionRepo } from "../../storage/canonical/FamilyDescriptionRepo";
import {
  FAMILY_DESCRIPTION_KINDS,
  type FamilyDescriptionKind,
} from "../../storage/canonical/FamilyDescriptionSchema";
import { TypeStringEnum } from "../../util/TypeBoxUtil";

export type FamilyDescriptionSetTaskInput = {
  readonly kind: FamilyDescriptionKind;
  readonly normalizedName: string;
  readonly text: string;
};

export type FamilyDescriptionSetTaskOutput = {
  readonly success: boolean;
};

/**
 * Sets the editorial description for a sponsor / underwriter family, keyed by
 * the already-normalized family name.
 */
export class FamilyDescriptionSetTask extends Task<
  FamilyDescriptionSetTaskInput,
  FamilyDescriptionSetTaskOutput
> {
  static readonly type = "FamilyDescriptionSetTask";
  static readonly category = "SEC";
  static readonly title = "Set family description";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: TypeStringEnum(FAMILY_DESCRIPTION_KINDS),
      normalizedName: Type.String(),
      text: Type.String(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(input: FamilyDescriptionSetTaskInput): Promise<FamilyDescriptionSetTaskOutput> {
    await new FamilyDescriptionRepo().setDescription(input.kind, input.normalizedName, input.text);
    return { success: true };
  }
}
