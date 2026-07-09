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
  // The configured extractor model id is not registered (or is misconfigured).
  // The deterministic parts of the filing still persist; the AI sections are
  // dead-lettered so a retry can resolve them once a model is available.
  "MODEL_RESOLUTION_ERROR",
  "LOW_CONFIDENCE_ALL",
  "PRIMARY_DOC_UNRESOLVED",
  "FETCH_ERROR",
  "PARSE_ERROR",
  "OVERSIZED_INPUT",
  // A structured-generation response that failed to echo back the
  // verification nonce planted in the trusted preamble (see NonceMismatchError)
  // — a real extraction failure (the response cannot be trusted), not a
  // model-availability issue, so it is version-gated for retry like
  // MODEL_INVALID_OUTPUT.
  "NONCE_MISMATCH",
] as const;
export type DeadLetterReasonCode = (typeof DEAD_LETTER_REASON_CODES)[number];

/**
 * Reason codes that reflect a transient model/provider *availability* failure
 * rather than a version-fixable extractor bug. Entries with these codes stay
 * eligible for retry even under the **same** extractor version — re-running the
 * filing once the model/provider is registered is exactly what recovers them,
 * so a version bump is neither required nor meaningful. Every other reason code
 * (a genuine extraction/parse/output bug) remains version-gated: it retries only
 * after the extractor code is fixed and its version bumped.
 */
export const MODEL_ERROR_REASON_CODES = ["MODEL_RESOLUTION_ERROR"] as const;

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
