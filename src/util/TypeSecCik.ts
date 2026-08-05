/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";

/**
 * The one definition of a CIK. Every CIK column in every schema goes through
 * this, so the SQL type it maps to is decided in exactly one place.
 *
 * `Type.Integer` (not `Type.Number`) is load-bearing: the DDL generator picks
 * the column type from the JSON-Schema type and bounds, and a bare `number`
 * falls all the way through to NUMERIC. A CIK is an integer, and the two
 * spellings do not interoperate — drivers return NUMERIC as a string and
 * BIGINT as a number, so a NUMERIC cik silently fails to match a BIGINT one in
 * any consumer that joins them in application code.
 *
 * This lives in `util` rather than beside the submissions schema on purpose:
 * every storage schema imports it, and the submissions module pulls in the
 * whole form-name graph and registers a global TypeBox format at import time.
 * Importing that from the storage tier forms a cycle that leaves TypeBox
 * half-initialized, which surfaces far away as "Object.defineProperty called
 * on non-object" from an unrelated `Type.Optional`. Keep this module's imports
 * to TypeBox alone.
 */
export const TypeSecCik = (annotations: Record<string, unknown> = {}) =>
  Type.Codec(
    Type.Integer({ format: "cik", minimum: 0, maximum: 9999999999, title: "CIK", ...annotations })
  )
    .Decode((value) => value.toString())
    .Encode((value) => parseInt(value));
