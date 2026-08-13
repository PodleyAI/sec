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
  // A storage handler threw on already-parsed data: a shape the persist path
  // does not handle, a constraint the row violates, or a backend error. Version
  // gated like PARSE_ERROR — the fix is in the extractor's storage code, so the
  // retry belongs after a version bump. A genuinely transient backend blip does
  // not need the worklist: the run is recorded as a failure, so the ordinary
  // forms sweep re-selects the filing on its next pass and a clean run resolves
  // the entry.
  "STORE_ERROR",
  "OVERSIZED_INPUT",
  // Every confident row cited a source_span that is not present verbatim in the
  // section text, so none of them can be trusted. Version-gated: the fix is in
  // the extractor's prompt or its span handling.
  "UNVERIFIED_SOURCE_SPAN",
  // The narrower form of the above: every confident row's source_span verified
  // verbatim but ran past the section's length cap. The rows are probably right
  // and only quoted too much, so it is distinguished from a genuine
  // verification failure — the two need opposite fixes.
  "SOURCE_SPAN_TOO_LONG",
  // A risk-factors response mixed rows shaped like captions with rows shaped
  // like category headings (see MixedRiskCaptionShapeError). The shape
  // heuristic cannot separate them, and persisting the punctuated subset would
  // record a partial risk list as the filing's complete disclosure.
  "MIXED_CAPTION_SHAPE",
  // A structured-generation response that failed to echo back the
  // verification nonce planted in the trusted preamble (see NonceMismatchError)
  // — a real extraction failure (the response cannot be trusted), not a
  // model-availability issue, so it is version-gated for retry like
  // MODEL_INVALID_OUTPUT.
  "NONCE_MISMATCH",
  // The provider throttled the call and the section spent its whole wait-out
  // budget without the window clearing. Transient and NOT version-fixable: the
  // extractor produced nothing wrong, it never got to run. Kept distinct from
  // MODEL_RESOLUTION_ERROR even though both retry under the same version —
  // that one means "the model id is not registered" and its operator action is
  // to add a key or register a provider, while this one means "wait for the
  // quota window, then retry". Merging them would make the worklist counts
  // unreadable during exactly the outage an operator would be triaging.
  "RATE_LIMITED",
] as const;
export type DeadLetterReasonCode = (typeof DEAD_LETTER_REASON_CODES)[number];

/**
 * Reason codes that reflect a transient model/provider *availability* failure
 * rather than a version-fixable extractor bug. Entries with these codes stay
 * eligible for retry even under the **same** extractor version — re-running the
 * filing once the model/provider is registered (or once the quota window has
 * moved on) is exactly what recovers them, so a version bump is neither
 * required nor meaningful. Every other reason code (a genuine
 * extraction/parse/output bug) remains version-gated: it retries only after the
 * extractor code is fixed and its version bumped.
 */
export const MODEL_ERROR_REASON_CODES = ["MODEL_RESOLUTION_ERROR", "RATE_LIMITED"] as const;

/**
 * Reason codes describing a **non-deterministic** model response rather than a
 * bug in the extractor: the same filing under the same extractor version can
 * come back clean on the next call. Retrying under the same version is the only
 * thing that recovers them, so they must not be version-gated — but unlike
 * {@link MODEL_ERROR_REASON_CODES} the retry is **bounded**. A genuinely
 * ambiguous section would otherwise sit on the worklist forever, unclearable by
 * any operator action, re-paying the AI cost of the largest section in the
 * filing on every sweep. After {@link NONDETERMINISTIC_RETRY_ATTEMPTS} recorded
 * attempts the entry falls back to the ordinary version gate, where a prompt or
 * heuristic fix plus a version bump is the honest remedy.
 */
export const NONDETERMINISTIC_REASON_CODES = ["MIXED_CAPTION_SHAPE"] as const;

/**
 * Recorded attempts after which a {@link NONDETERMINISTIC_REASON_CODES} entry
 * stops being retry-eligible under its own version. `attempts` counts
 * CONSECUTIVE failures of the current `(reason_code, failed_extractor_version)`
 * pair, so this counts real re-runs of THIS failure — the section's earlier
 * history under other codes or versions does not spend the budget.
 */
export const NONDETERMINISTIC_RETRY_ATTEMPTS = 3;

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
