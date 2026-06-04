/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

export const BeneficialOwnershipSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  extractor_id: Type.String({ maxLength: 16 }),
  observation_index: Type.Integer({ minimum: 0 }),
  owner_kind: Type.Union([Type.Literal("person"), Type.Literal("company")], {
    description: "person | company",
  }),
  observation_id: TypeNullable(
    Type.Integer({ description: "FK to the person/company observation" })
  ),
  security_class: TypeNullable(Type.String({ maxLength: 128 })),
  shares_owned: TypeNullable(Type.Number()),
  percent_owned: TypeNullable(Type.Number({ description: "pre-offering %" })),
  shares_offered: TypeNullable(Type.Number()),
  shares_after: TypeNullable(Type.Number()),
  percent_after: TypeNullable(Type.Number()),
  is_selling_stockholder: Type.Boolean(),
  footnote: TypeNullable(Type.String()),
});

export type BeneficialOwnership = Static<typeof BeneficialOwnershipSchema>;

export const BeneficialOwnershipPrimaryKeyNames = [
  "accession_number",
  "extractor_id",
  "observation_index",
] as const;

export type BeneficialOwnershipRepositoryStorage = ITabularStorage<
  typeof BeneficialOwnershipSchema,
  typeof BeneficialOwnershipPrimaryKeyNames,
  BeneficialOwnership
>;

export const BENEFICIAL_OWNERSHIP_REPOSITORY_TOKEN =
  createServiceToken<BeneficialOwnershipRepositoryStorage>(
    "sec.storage.beneficialOwnershipRepository"
  );
