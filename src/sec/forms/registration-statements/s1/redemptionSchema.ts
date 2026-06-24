/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { TypeNullable } from "../../../../util/TypeBoxUtil";

/** The single realized-redemption object the model returns from an 8-K. */
export const RedemptionOutputSchema = Type.Object({
  redemption_shares: TypeNullable(
    Type.Integer({ minimum: 0, description: "Shares redeemed (public shares tendered)" })
  ),
  redemption_amount: TypeNullable(
    Type.Number({ minimum: 0, description: "Total dollars paid to redeeming holders" })
  ),
  price_per_share: TypeNullable(
    Type.Number({ minimum: 0, description: "Per-share redemption / trust value, when stated" })
  ),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  source_span: TypeNullable(Type.String()),
});

export type RedemptionRow = Static<typeof RedemptionOutputSchema>;
