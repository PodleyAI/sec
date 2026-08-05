/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * One Summary Compensation Table cell row (Reg S-K Item 402): a named executive
 * officer's compensation for one fiscal year, as disclosed by one filing.
 * Append-only per accession — a later amendment restating the table writes its
 * own rows under its own accession, so the series stays reconstructable.
 *
 * The officer is identified by `observation_id`, the same link the beneficial
 * ownership and related-party rows use, rather than by a duplicated name column.
 * `principal_position` is kept on the row because it is the position AS STATED
 * IN THE TABLE for that fiscal year, which is not recoverable from the
 * observation: the compensation table names only the named executive officers,
 * a strict subset of the management roster, so it deliberately mints no
 * `person_role` tenure.
 */
export const ExecutiveCompensationSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  extractor_id: Type.String({ maxLength: 16 }),
  /**
   * Position of the row in the table. Not an observation index: one officer
   * shown for two fiscal years is two rows but ONE person observation, so the
   * row key and the `observation_id` FK are deliberately separate.
   */
  row_index: Type.Integer({ minimum: 0 }),
  observation_id: TypeNullable(Type.Integer({ description: "FK to the person observation" })),
  principal_position: TypeNullable(Type.String({ maxLength: 256 })),
  fiscal_year: TypeNullable(Type.Integer({ minimum: 1900, maximum: 2100 })),
  salary: TypeNullable(Type.Number()),
  bonus: TypeNullable(Type.Number()),
  stock_awards: TypeNullable(Type.Number()),
  option_awards: TypeNullable(Type.Number()),
  non_equity_incentive: TypeNullable(
    Type.Number({ description: "Non-equity incentive plan compensation" })
  ),
  pension_and_nqdc: TypeNullable(
    Type.Number({
      description: "Change in pension value and nonqualified deferred compensation earnings",
    })
  ),
  all_other_compensation: TypeNullable(Type.Number()),
  total: TypeNullable(Type.Number()),
  footnote: TypeNullable(Type.String()),
});

export type ExecutiveCompensation = Static<typeof ExecutiveCompensationSchema>;

export const ExecutiveCompensationPrimaryKeyNames = [
  "accession_number",
  "extractor_id",
  "row_index",
] as const;

export type ExecutiveCompensationRepositoryStorage = ITabularStorage<
  typeof ExecutiveCompensationSchema,
  typeof ExecutiveCompensationPrimaryKeyNames,
  ExecutiveCompensation
>;

export const EXECUTIVE_COMPENSATION_REPOSITORY_TOKEN =
  createServiceToken<ExecutiveCompensationRepositoryStorage>(
    "sec.storage.executiveCompensationRepository"
  );
