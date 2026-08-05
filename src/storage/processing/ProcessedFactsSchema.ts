/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";
import { TypeSecCik } from "../../util/TypeSecCik";

/**
 * Outcome classification for a facts fetch/store attempt. `NO_XBRL_FACTS`
 * (companyfacts 404 — the entity has no XBRL data) is a successful terminal
 * outcome, not a failure; the remaining codes mark rows for the
 * `update facts --retry-failed` sweep.
 */
export const FACTS_REASON_CODES = [
  "NO_XBRL_FACTS",
  "FETCH_ERROR",
  "PARSE_ERROR",
  "STORE_ERROR",
] as const;
export type FactsReasonCode = (typeof FACTS_REASON_CODES)[number];

export const ProcessedFactsSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) - unique identifier for entity" }),
  last_processed: Type.String({
    description: "Date this CIK's facts were last processed (YYYY-MM-DD format)",
  }),
  success: Type.Boolean({
    description: "Whether the last processing was successful",
  }),
  reason_code: TypeNullable(
    Type.String({
      maxLength: 32,
      description: "Outcome classification (FACTS_REASON_CODES); null for a plain success",
    })
  ),
  detail: TypeNullable(
    Type.String({
      description: "Error detail for failed attempts (truncated)",
    })
  ),
  attempts: Type.Integer({
    minimum: 0,
    description: "Consecutive failed attempts; reset to 0 on success",
  }),
});

export type ProcessedFacts = Static<typeof ProcessedFactsSchema>;

export const ProcessedFactsPrimaryKeyNames = ["cik"] as const;

export type ProcessedFactsRepositoryStorage = ITabularStorage<
  typeof ProcessedFactsSchema,
  typeof ProcessedFactsPrimaryKeyNames,
  ProcessedFacts
>;

export const PROCESSED_FACTS_REPOSITORY_TOKEN = createServiceToken<ProcessedFactsRepositoryStorage>(
  "sec.storage.processedFactsRepository"
);
