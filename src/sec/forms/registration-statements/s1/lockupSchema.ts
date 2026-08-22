/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "workglow";

const NULLABLE_NUMBER = { type: ["number", "null"] } as const;
const NULLABLE_STRING = { type: ["string", "null"] } as const;

/**
 * Who is locked up. A prospectus states several lock-ups with different terms
 * — the underwriter's on the whole float, the sponsor's on its founder shares,
 * a longer one on the private-placement warrants — so this is a row-level
 * discriminator rather than one lock-up per filing.
 */
export const LOCKUP_HOLDER_CLASSES = [
  "founder-shares",
  "private-placement-warrants",
  "sponsor",
  "target-shareholders",
  "pipe",
  "management",
  "other",
] as const;
export type LockupHolderClass = (typeof LOCKUP_HOLDER_CLASSES)[number];

/**
 * What the lock-up's clock runs from. A SPAC's founder lock-up is customarily
 * measured from the CLOSING of the business combination, while the
 * underwriter's is measured from the pricing of the offering — so a duration
 * without its anchor names no date at all.
 */
export const LOCKUP_ANCHORS = ["closing", "ipo", "effective-date", "other"] as const;
export type LockupAnchor = (typeof LOCKUP_ANCHORS)[number];

/**
 * One lock-up as the filing states it.
 *
 * Every term is nullable because filers state different subsets: an
 * underwriter lock-up is a bare 180 days with no price test, while a founder
 * lock-up is typically "one year, or earlier if the shares trade at or above
 * $12.00 for 20 trading days within any 30-trading-day period commencing at
 * least 150 days after the closing" — a duration AND a price trigger, either of
 * which can release first.
 */
export const LockupOutputSchema = {
  type: "object",
  properties: {
    lockups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          holder_class: { type: "string", enum: [...LOCKUP_HOLDER_CLASSES] },
          security: NULLABLE_STRING,
          duration_days: NULLABLE_NUMBER,
          anchor_event: { type: ["string", "null"], enum: [...LOCKUP_ANCHORS, null] },
          price_trigger: NULLABLE_NUMBER,
          /** Sessions at or above the trigger the filing requires (the "20"). */
          trigger_days_at_or_above: NULLABLE_NUMBER,
          /** The window those sessions are counted in (the "30"). */
          trigger_window_days: NULLABLE_NUMBER,
          /**
           * The delay before the price test may start running, in days from the
           * anchor (the "commencing at least 150 days after"). Customary and
           * easy to miss, and without it a trigger evaluates months early.
           */
          trigger_start_delay_days: NULLABLE_NUMBER,
          confidence: { type: "number", minimum: 0, maximum: 1 },
          source_span: { type: "string" },
        },
        required: ["holder_class", "confidence", "source_span"],
        additionalProperties: false,
      },
    },
    nonce_seen: { type: "string", pattern: "^[0-9a-f]{16}$" },
  },
  required: ["lockups", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface LockupRow {
  holder_class: LockupHolderClass;
  security: string | null;
  duration_days: number | null;
  anchor_event: LockupAnchor | null;
  price_trigger: number | null;
  trigger_days_at_or_above: number | null;
  trigger_window_days: number | null;
  trigger_start_delay_days: number | null;
  confidence: number;
  source_span: string;
}
