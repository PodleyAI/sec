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

export type FamilyDescriptionGetTaskInput = {
  readonly kind: FamilyDescriptionKind;
  readonly normalizedName: string;
};

export type FamilyDescriptionGetTaskOutput = {
  readonly description: string | null;
};

/**
 * Reads the editorial description for a sponsor / underwriter family, keyed by
 * the already-normalized family name. Null when none has been set.
 */
export class FamilyDescriptionGetTask extends Task<
  FamilyDescriptionGetTaskInput,
  FamilyDescriptionGetTaskOutput
> {
  static readonly type = "FamilyDescriptionGetTask";
  static readonly category = "SEC";
  static readonly title = "Get family description";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: TypeStringEnum(FAMILY_DESCRIPTION_KINDS),
      normalizedName: Type.String(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      description: Type.Union([Type.String(), Type.Null()]),
    });
  }

  async execute(input: FamilyDescriptionGetTaskInput): Promise<FamilyDescriptionGetTaskOutput> {
    const description = await new FamilyDescriptionRepo().getDescription(
      input.kind,
      input.normalizedName
    );
    return { description };
  }
}
