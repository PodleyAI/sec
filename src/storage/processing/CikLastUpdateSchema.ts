/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import { createServiceToken } from "@workglow/util";
import { Static, Type } from "typebox";

export const CikLastUpdateSchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  last_update: Type.String({
    description: "Date of the last known update for this CIK (YYYY-MM-DD format)",
  }),
});

export type CikLastUpdate = Static<typeof CikLastUpdateSchema>;

export const CikLastUpdatePrimaryKeyNames = ["cik"] as const;

export type CikLastUpdateRepositoryStorage = ITabularStorage<
  typeof CikLastUpdateSchema,
  typeof CikLastUpdatePrimaryKeyNames,
  CikLastUpdate
>;

export const CIK_LAST_UPDATE_REPOSITORY_TOKEN =
  createServiceToken<CikLastUpdateRepositoryStorage>("sec.storage.cikLastUpdateRepository");
