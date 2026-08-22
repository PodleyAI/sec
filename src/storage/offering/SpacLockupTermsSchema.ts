/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../util/TypeSecCik";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * One lock-up as a prospectus states it, keyed
 * `(extractor_id, accession_number, lockup_index)`.
 *
 * Several rows per filing rather than one, because a filing states several: the
 * underwriter's lock-up on the whole float, the sponsor's on its founder
 * shares, and often a longer one on the private-placement warrants. They have
 * different durations, different anchors and different price tests, and folding
 * them into one row would state a release date that applies to none of them.
 *
 * Every term is nullable because filers state different subsets. An underwriter
 * lock-up is a bare 180 days with no price test; a founder lock-up is typically
 * "one year, or earlier if the shares close at or above $12.00 for 20 trading
 * days within any 30-trading-day period commencing at least 150 days after the
 * closing" — a duration AND a price trigger, either of which can release first.
 */
export const SpacLockupTermsSchema = Type.Object({
  extractor_id: Type.String({ maxLength: 16 }),
  accession_number: Type.String({ maxLength: 25 }),
  lockup_index: Type.Integer({ minimum: 0, description: "0-based ordinal within the filing" }),
  cik: TypeNullable(TypeSecCik()),

  holder_class: Type.String({
    maxLength: 32,
    description: "founder-shares | private-placement-warrants | sponsor | ...",
  }),
  security: TypeNullable(
    Type.String({ maxLength: 200, description: "The locked security, as filed" })
  ),

  duration_days: TypeNullable(Type.Integer({ description: "Length of the lock-up, in days" })),
  anchor_event: TypeNullable(
    Type.String({ maxLength: 24, description: "closing | ipo | effective-date | other" })
  ),

  /**
   * The price the security must reach, in dollars.
   *
   * With the two columns below it this is an evaluable condition rather than a
   * sentence: "at or above `price_trigger` on `trigger_days_at_or_above`
   * trading days within any `trigger_window_days`-trading-day period".
   */
  price_trigger: TypeNullable(Type.Number()),
  trigger_days_at_or_above: TypeNullable(Type.Integer({ minimum: 1 })),
  trigger_window_days: TypeNullable(Type.Integer({ minimum: 1 })),
  /**
   * Days after the anchor before the price test may begin running.
   *
   * Customary ("commencing at least 150 days after the closing") and easy to
   * miss; without it a trigger evaluates months early and reports a release
   * that had not yet become available.
   */
  trigger_start_delay_days: TypeNullable(Type.Integer({ minimum: 0 })),

  confidence: TypeNullable(Type.Number()),
  source_span: TypeNullable(Type.String()),
  created_at: Type.String(),
});
export type SpacLockupTerms = Static<typeof SpacLockupTermsSchema>;

export const SpacLockupTermsPrimaryKeyNames = [
  "extractor_id",
  "accession_number",
  "lockup_index",
] as const;

export type SpacLockupTermsRepositoryStorage = ITabularStorage<
  typeof SpacLockupTermsSchema,
  typeof SpacLockupTermsPrimaryKeyNames,
  SpacLockupTerms
>;

export const SPAC_LOCKUP_TERMS_REPOSITORY_TOKEN =
  createServiceToken<SpacLockupTermsRepositoryStorage>("sec.storage.spacLockupTermsRepository");
