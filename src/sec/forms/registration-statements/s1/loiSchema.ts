/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { TypeNullable } from "../../../../util/TypeBoxUtil";

/** The single letter-of-intent object the model returns from an 8-K narrative. */
export const LoiOutputSchema = Type.Object({
  is_loi: Type.Boolean({
    description:
      "true ONLY if the text reports entering into a non-binding letter of intent " +
      "(or agreement in principle / memorandum of understanding) for a business combination",
  }),
  target_name: TypeNullable(
    Type.String({ maxLength: 200, description: "Proposed business-combination target, if named" })
  ),
  loi_date: TypeNullable(
    Type.String({
      description: "Date the LOI was signed/announced as stated in the text (YYYY-MM-DD), or null",
    })
  ),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  source_span: TypeNullable(Type.String()),
  nonce_seen: Type.String({ pattern: "^[0-9a-f]{16}$" }),
});

export type LoiRow = Static<typeof LoiOutputSchema>;
