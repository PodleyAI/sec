/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import { createServiceToken } from "@workglow/util";
import { Static, Type } from "typebox";

export const ProcessedSubmissionsSchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  last_processed: Type.String({
    description: "Date this CIK's submissions were last processed (YYYY-MM-DD format)",
  }),
  success: Type.Boolean({
    description: "Whether the last processing was successful",
  }),
});

export type ProcessedSubmissions = Static<typeof ProcessedSubmissionsSchema>;

export const ProcessedSubmissionsPrimaryKeyNames = ["cik"] as const;

export type ProcessedSubmissionsRepositoryStorage = ITabularStorage<
  typeof ProcessedSubmissionsSchema,
  typeof ProcessedSubmissionsPrimaryKeyNames,
  ProcessedSubmissions
>;

export const PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN =
  createServiceToken<ProcessedSubmissionsRepositoryStorage>(
    "sec.storage.processedSubmissionsRepository"
  );
