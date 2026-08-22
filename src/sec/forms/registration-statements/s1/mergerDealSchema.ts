/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { TypeNullable } from "../../../../util/TypeBoxUtil";

/** The single merger-deal object the model returns from a merger proxy. */
export const MergerDealOutputSchema = Type.Object({
  target_name: TypeNullable(
    Type.String({ description: "Operating company the SPAC will merge with" })
  ),
  // Optional (not a required key) so a model — or a pre-1.1.0 replay — that omits
  // it still validates against the schema; the other fields predate this change
  // and stay required-nullable.
  target_description: Type.Optional(
    TypeNullable(Type.String({ description: "Short description of the target company's business" }))
  ),
  pipe_amount: TypeNullable(Type.Number({ description: "Total PIPE investment in dollars" })),
  // Optional, like `target_description`, so a pre-1.2.0 replay still validates.
  // Both are the values the proxy ANNOUNCES for the combination, which is what
  // makes them a valuation of the target at the deal — not a realized outcome.
  equity_value: Type.Optional(
    TypeNullable(
      Type.Number({
        description: "Announced equity value of the combined company, in whole dollars",
      })
    )
  ),
  enterprise_value: Type.Optional(
    TypeNullable(
      Type.Number({
        description: "Announced enterprise value of the combined company, in whole dollars",
      })
    )
  ),
  merger_consideration: TypeNullable(
    Type.String({ description: "Short verbatim description of the consideration" })
  ),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  source_span: TypeNullable(Type.String()),
  nonce_seen: Type.String({ pattern: "^[0-9a-f]{16}$" }),
});

export type MergerDealRow = Static<typeof MergerDealOutputSchema>;
