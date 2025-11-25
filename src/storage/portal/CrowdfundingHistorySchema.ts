/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TabularRepository } from "@podley/storage";
import { createServiceToken } from "@podley/util";
import { Static, Type } from "typebox";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * Crowdfunding History schema - tracks changes to crowdfunding entity attributes over time
 */
export const CrowdfundingHistorySchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  valid_from: Type.String({
    format: "date-time",
    description: "When this version became valid",
  }),
  valid_to: TypeNullable(
    Type.String({
      format: "date-time",
      description: "When this version ceased to be valid (null = current)",
    })
  ),
  file_number: Type.String({
    maxLength: 10,
    description: "File number",
  }),
  filing_date: Type.String({
    format: "date",
    description: "Filing date",
  }),
  name: TypeNullable(
    Type.String({
      maxLength: 140,
      description: "Entity name",
    })
  ),
  legal_status: TypeNullable(
    Type.String({
      maxLength: 50,
      description: "Legal status",
    })
  ),
  state_jurisdiction: TypeNullable(
    Type.String({
      maxLength: 2,
      description: "State jurisdiction code",
    })
  ),
  date_incorporation: TypeNullable(
    Type.String({
      format: "date",
      description: "Date of incorporation",
    })
  ),
  url: TypeNullable(
    Type.String({
      maxLength: 255,
      description: "URL",
    })
  ),
  portal_cik: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Portal CIK",
    })
  ),
  status: TypeNullable(
    Type.String({
      maxLength: 20,
      description: "Status",
    })
  ),
  change_source: Type.String({
    description: "Source of this change (e.g., 'Form C', 'SUBMISSION_UPDATE')",
  }),
  change_date: Type.String({
    format: "date-time",
    description: "When this change was recorded in our system",
  }),
});

export type CrowdfundingHistory = Static<typeof CrowdfundingHistorySchema>;

/**
 * Crowdfunding History repository storage type and primary key definitions
 */
export const CrowdfundingHistoryPrimaryKeyNames = ["cik", "valid_from"] as const;
export type CrowdfundingHistoryRepositoryStorage = TabularRepository<
  typeof CrowdfundingHistorySchema,
  typeof CrowdfundingHistoryPrimaryKeyNames,
  CrowdfundingHistory
>;

/**
 * Dependency injection tokens for repositories
 */
export const CROWDFUNDING_HISTORY_REPOSITORY_TOKEN =
  createServiceToken<CrowdfundingHistoryRepositoryStorage>(
    "sec.storage.crowdfundingHistoryRepository"
  );
