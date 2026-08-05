/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeNullable, TypeStringEnum } from "../../util/TypeBoxUtil";

/**
 * How strongly the submissions metadata alone says "SPAC".
 * `classifySpacCandidate` is the authoritative statement of the ladder; this is
 * the same rule in short:
 *
 * - `high`   — an S-1-family registration plus either a blank-check name
 *              (current or former) or EDGAR's 6770 coding, with nothing arguing
 *              against it. 6770-plus-registration sits here on measurement (150
 *              of 168 such 2019-2024 registrants appear in embarc's curated
 *              list, 89%).
 * - `medium` — one weakened or contradicted signal: a weak-class name with a
 *              registration and nothing else, or a 6770 filer that registered
 *              only AFTER shedding a blank-check name.
 * - `low`    — a blank-check name only in history with the registration filed
 *              after the rename (the Form 10 shell pattern), OR 6770 with no
 *              registration on file at all.
 */
export const SPAC_CANDIDATE_CONFIDENCES = ["high", "medium", "low"] as const;
export type SpacCandidateConfidence = (typeof SPAC_CANDIDATE_CONFIDENCES)[number];

/**
 * A SPAC identified from submissions metadata alone — entity SIC, name history,
 * and which registration form the company first filed. One row per CIK.
 *
 * This is a *screen*, not a verdict. The authoritative classification is the
 * S-1 extractor's, which reads the as-filed SGML header SIC and falls back to an
 * AI content classifier (`s1_classification`, `spac`); this table exists because
 * that requires fetching and parsing every registration document, while these
 * signals are already in the database the moment submissions are ingested. Its
 * intended uses are a usable list before any forms processing, and a worklist to
 * point that processing at.
 *
 * Every signal that fired is kept as its own column rather than collapsed into
 * the confidence, so a consumer can re-derive its own rule without re-scanning.
 */
export const SpacCandidateSchema = Type.Object({
  cik: TypeSecCik(),
  name: TypeNullable(Type.String({ maxLength: 200, description: "Entity name at scan time" })),
  current_sic: TypeNullable(Type.Integer({ minimum: 0, description: "entities.sic at scan time" })),

  /** `entities.sic` reads 6770 (Blank Checks) right now. */
  signal_sic_6770: Type.Boolean(),
  /** The entity's *current* name looks like a blank check. */
  signal_name_match: Type.Boolean(),
  /** A *former* name looked like a blank check; carries that name. */
  signal_renamed_from: TypeNullable(Type.String({ maxLength: 200 })),

  /**
   * Earliest Securities Act registration and its form — `S-1` / `F-1` for a
   * domestic or foreign-private-issuer IPO, `DRS` for the confidential draft
   * that now precedes most of them.
   */
  first_reg_form: TypeNullable(Type.String({ maxLength: 32 })),
  first_reg_date: TypeNullable(Type.String({ description: "YYYY-MM-DD" })),

  /**
   * Whether that registration was filed while the company still carried a
   * blank-check name. Null when there is no rename to compare against.
   *
   * This is the field that separates a SPAC from a reverse-merger shell: a SPAC
   * registers its IPO *as* the blank check, whereas a Form 10 shell registers
   * on 10-12G, merges, and only then files an S-1 to register the operating
   * company's resale.
   */
  reg_while_spac_named: TypeNullable(Type.Boolean()),

  confidence: TypeStringEnum(SPAC_CANDIDATE_CONFIDENCES),
  identified_at: Type.String({ description: "ISO 8601 timestamp of the scan that wrote this row" }),
});
export type SpacCandidate = Static<typeof SpacCandidateSchema>;

export const SpacCandidatePrimaryKeyNames = ["cik"] as const;

export type SpacCandidateRepositoryStorage = ITabularStorage<
  typeof SpacCandidateSchema,
  typeof SpacCandidatePrimaryKeyNames,
  SpacCandidate
>;

export const SPAC_CANDIDATE_REPOSITORY_TOKEN = createServiceToken<SpacCandidateRepositoryStorage>(
  "sec.storage.spacCandidateRepository"
);
