/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

export const DEAD_LETTER_REASON_CODES = [
  "SECTION_NOT_FOUND",
  "MODEL_INVALID_OUTPUT",
  "MODEL_EMPTY",
  "LOW_CONFIDENCE_ALL",
  "PRIMARY_DOC_UNRESOLVED",
  "FETCH_ERROR",
  "PARSE_ERROR",
  "OVERSIZED_INPUT",
] as const;
export type DeadLetterReasonCode = (typeof DEAD_LETTER_REASON_CODES)[number];

export const DEAD_LETTER_STATUSES = ["pending", "resolved", "abandoned"] as const;
export type DeadLetterStatus = (typeof DEAD_LETTER_STATUSES)[number];

/** `section_name = ""` denotes a filing-level (non-section) failure. */
export const ExtractionDeadLetterSchema = Type.Object({
  extractor_id: Type.String({ maxLength: 16 }),
  accession_number: Type.String({ maxLength: 25 }),
  section_name: Type.String({ maxLength: 128, description: "'' for filing-level failures" }),
  reason_code: Type.String({ maxLength: 32 }),
  detail: TypeNullable(Type.String()),
  failed_extractor_version: Type.String({ maxLength: 32 }),
  status: Type.String({ maxLength: 16 }),
  attempts: Type.Integer({ minimum: 0 }),
  first_seen_at: Type.String(),
  last_attempt_at: Type.String(),
  source_run_id: TypeNullable(Type.String({ maxLength: 64 })),
});

export type ExtractionDeadLetter = Static<typeof ExtractionDeadLetterSchema>;

export const ExtractionDeadLetterPrimaryKeyNames = [
  "extractor_id",
  "accession_number",
  "section_name",
] as const;

export type ExtractionDeadLetterRepositoryStorage = ITabularStorage<
  typeof ExtractionDeadLetterSchema,
  typeof ExtractionDeadLetterPrimaryKeyNames,
  ExtractionDeadLetter
>;

export const EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN =
  createServiceToken<ExtractionDeadLetterRepositoryStorage>(
    "sec.storage.extractionDeadLetterRepository"
  );
