/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Static, Type } from "typebox";
import { createServiceToken, type ITabularStorage } from "workglow";

/**
 * One CSV row from any Form ADV table, kept verbatim.
 *
 * The SEC publishes ADV as a zip of wide CSVs — schedules for owners, related
 * advisers, private funds, custodians, auditors, disciplinary history — whose
 * shapes change on their own schedule. Landing them generically means a new
 * column, or a whole new member, needs no code: `data` is the row keyed by its
 * file's own header, and every value stays queryable through the backend's JSON
 * functions.
 *
 * The cost is honest and stated: nothing here is typed, so a query against
 * `data` is a query against whatever the SEC called that column this quarter.
 * The columns worth filtering on are lifted into `adv_adviser`.
 */
export const AdvRowSchema = Type.Object({
  /** The archive period the row came from, e.g. `2026-06`. */
  snapshot: Type.String({ maxLength: 16 }),
  /** The archive member the row came from, without its extension. */
  table_name: Type.String({ maxLength: 128 }),
  /** Position within that member, so the primary key needs no natural key. */
  row_index: Type.Integer(),
  /** The row as `{ header column: value }`, JSON-encoded. */
  data: Type.String(),
});

export type AdvRow = Static<typeof AdvRowSchema>;

export const AdvRowPrimaryKeyNames = ["snapshot", "table_name", "row_index"] as const;

export type AdvRowRepositoryStorage = ITabularStorage<
  typeof AdvRowSchema,
  typeof AdvRowPrimaryKeyNames,
  AdvRow
>;

export const ADV_ROW_REPOSITORY_TOKEN =
  createServiceToken<AdvRowRepositoryStorage>("sec.storage.advRow");
