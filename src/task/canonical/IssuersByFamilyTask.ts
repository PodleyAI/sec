/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { spacIssuersByFamilyName } from "../../commands/sponsorFamily";
import { ipoIssuersByUnderwriterFamilyName } from "../../commands/underwriterFamily";
import type { FamilyKind } from "./familyTier";

export type IssuersByFamilyTaskInput = {
  readonly family: FamilyKind;
  readonly name: string;
  readonly resolverVersion: string;
};

export type IssuersByFamilyTaskOutput = {
  readonly ciks: number[];
};

/**
 * Alias-aware issuer lookup for a family tier: SPAC issuer CIKs backed by a
 * sponsor family, or IPO issuer CIKs underwritten by an underwriter family.
 */
export class IssuersByFamilyTask extends Task<IssuersByFamilyTaskInput, IssuersByFamilyTaskOutput> {
  static readonly type = "IssuersByFamilyTask";
  static readonly category = "SEC";
  static readonly title = "Issuers by family";
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
      ciks: Type.Array(Type.Number()),
    });
  }

  async execute(input: IssuersByFamilyTaskInput): Promise<IssuersByFamilyTaskOutput> {
    const ciks =
      input.family === "sponsor"
        ? await spacIssuersByFamilyName(input.name, input.resolverVersion)
        : await ipoIssuersByUnderwriterFamilyName(input.name, input.resolverVersion);
    return { ciks };
  }
}
