/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type, type TObject, type TSchema } from "typebox";

/**
 * Output schema shared by the query tasks: a page of rows plus the exact (or
 * lower-bound, see `totalApprox` on {@link QueryResult}) match count. Rows are
 * typed `unknown` at the port level — each task's TypeScript output type
 * carries the precise row shape; re-declaring every storage schema here would
 * drift.
 */
export function queryResultSchema(extra: Record<string, TSchema> = {}): TObject {
  return Type.Object({
    rows: Type.Array(Type.Unknown()),
    total: Type.Number(),
    totalApprox: Type.Optional(Type.Object({ atLeast: Type.Number() })),
    ...extra,
  });
}
