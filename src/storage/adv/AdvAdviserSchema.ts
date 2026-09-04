/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Static, Type } from "typebox";
import { createServiceToken, type ITabularStorage } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * One investment adviser, as its latest Form ADV Part 1A base filing describes
 * it.
 *
 * The typed columns are the ones people filter on. Every other column of every
 * other ADV table lands in `adv_row` as JSON, which is what keeps this a
 * fifteen-table example rather than a seventy-three-table one: the SEC's ADV
 * data dictionary is long, changes on its own schedule, and almost none of it
 * needs a column of its own to be queryable.
 */
export const AdvAdviserSchema = Type.Object({
  /** The archive period the row came from, e.g. `2026-06`. */
  snapshot: Type.String({ maxLength: 16 }),
  /** Central Registration Depository number — the adviser's stable identifier. */
  crd_number: Type.String({ maxLength: 16 }),
  sec_file_number: TypeNullable(Type.String({ maxLength: 32 })),
  legal_name: TypeNullable(Type.String({ maxLength: 512 })),
  primary_business_name: TypeNullable(Type.String({ maxLength: 512 })),
  /** True for an Exempt Reporting Adviser, which files a shorter Part 1A. */
  is_era: Type.Boolean(),
  main_office_city: TypeNullable(Type.String({ maxLength: 128 })),
  main_office_state: TypeNullable(Type.String({ maxLength: 64 })),
  main_office_country: TypeNullable(Type.String({ maxLength: 64 })),
  /** Regulatory assets under management, in dollars (Item 5.F.2.c). */
  regulatory_aum: TypeNullable(Type.Number()),
  filing_id: TypeNullable(Type.String({ maxLength: 32 })),
  date_submitted: TypeNullable(Type.String({ maxLength: 10 })),
});

export type AdvAdviser = Static<typeof AdvAdviserSchema>;

export const AdvAdviserPrimaryKeyNames = ["snapshot", "crd_number"] as const;

export type AdvAdviserRepositoryStorage = ITabularStorage<
  typeof AdvAdviserSchema,
  typeof AdvAdviserPrimaryKeyNames,
  AdvAdviser
>;

export const ADV_ADVISER_REPOSITORY_TOKEN =
  createServiceToken<AdvAdviserRepositoryStorage>("sec.storage.advAdviser");
