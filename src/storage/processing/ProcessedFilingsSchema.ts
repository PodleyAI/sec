/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import { createServiceToken } from "@workglow/util";
import { Static, Type } from "typebox";

export const ProcessedFilingsSchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  accession_number: Type.String({
    maxLength: 20,
    description: "SEC accession number - unique identifier for the filing",
  }),
  form: Type.String({
    maxLength: 8,
    description: "Form type (e.g., D, C, 1-A)",
  }),
  last_processed: Type.String({
    description: "Date this filing was last processed (YYYY-MM-DD format)",
  }),
  success: Type.Boolean({
    description: "Whether the last processing was successful",
  }),
});

export type ProcessedFilings = Static<typeof ProcessedFilingsSchema>;

export const ProcessedFilingsPrimaryKeyNames = ["cik", "accession_number"] as const;

export type ProcessedFilingsRepositoryStorage = ITabularStorage<
  typeof ProcessedFilingsSchema,
  typeof ProcessedFilingsPrimaryKeyNames,
  ProcessedFilings
>;

export const PROCESSED_FILINGS_REPOSITORY_TOKEN =
  createServiceToken<ProcessedFilingsRepositoryStorage>(
    "sec.storage.processedFilingsRepository"
  );
