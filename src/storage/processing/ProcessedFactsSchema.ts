/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import { createServiceToken } from "@workglow/util";
import { Static, Type } from "typebox";

export const ProcessedFactsSchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  last_processed: Type.String({
    description: "Date this CIK's facts were last processed (YYYY-MM-DD format)",
  }),
  success: Type.Boolean({
    description: "Whether the last processing was successful",
  }),
});

export type ProcessedFacts = Static<typeof ProcessedFactsSchema>;

export const ProcessedFactsPrimaryKeyNames = ["cik"] as const;

export type ProcessedFactsRepositoryStorage = ITabularStorage<
  typeof ProcessedFactsSchema,
  typeof ProcessedFactsPrimaryKeyNames,
  ProcessedFacts
>;

export const PROCESSED_FACTS_REPOSITORY_TOKEN =
  createServiceToken<ProcessedFactsRepositoryStorage>("sec.storage.processedFactsRepository");
