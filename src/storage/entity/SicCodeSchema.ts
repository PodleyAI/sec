/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * SIC Code schema - represents Standard Industrial Classification codes
 */
export const SicCodeSchema = Type.Object({
  sic: Type.Integer({
    minimum: 0,
    maximum: 9999,
    description: "Standard Industrial Classification code",
  }),
  description: TypeNullable(
    Type.String({
      description: "Description of the SIC code industry classification",
    })
  ),
});

export type SicCode = Static<typeof SicCodeSchema>;

/**
 * SIC Code repository storage type and primary key definitions
 */
export const SicCodePrimaryKeyNames = ["sic"] as const;
export type SicCodeRepositoryStorage = ITabularStorage<
  typeof SicCodeSchema,
  typeof SicCodePrimaryKeyNames,
  SicCode
>;

/**
 * Dependency injection tokens for repositories
 */
export const SIC_CODE_REPOSITORY_TOKEN = createServiceToken<SicCodeRepositoryStorage>(
  "sec.storage.sicCodeRepository"
);
