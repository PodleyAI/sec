/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * SIC Code schema - represents Standard Industrial Classification codes
 */
export const CikNameSchema = Type.Object({
  cik: TypeSecCik(),
  name: TypeNullable(
    Type.String({
      description: "Name of the entity",
    })
  ),
});

export type CikNameType = Static<typeof CikNameSchema>;

/**
 * SIC Code repository storage type and primary key definitions
 */
export const CikNamePrimaryKeyNames = ["cik"] as const;
export type CikNameRepositoryStorage = ITabularStorage<
  typeof CikNameSchema,
  typeof CikNamePrimaryKeyNames,
  CikNameType
>;

/**
 * Dependency injection tokens for repositories
 */
export const CIK_NAME_REPOSITORY_TOKEN = createServiceToken<CikNameRepositoryStorage>(
  "sec.storage.cikNameRepository"
);
