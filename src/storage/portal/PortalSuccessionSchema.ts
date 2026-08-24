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
 * One succession claim from a CFPORTAL filing's Item 1 "Successions" block.
 *
 * EDGAR's own record of one funding portal taking over another's registration:
 * `isSucceedingBusiness` plus up to five `acquiredHistoryDetails`, each naming
 * the acquired portal and — the part that makes it usable — its SEC file
 * number. File numbers are 1:1 with CIKs across the whole funding-portal
 * universe, so `predecessor_file_number` resolves to a filer where a free-text
 * name would not.
 *
 * Append-only and keyed by accession, so a filer's claim is recorded once per
 * filing that makes it and a replay is idempotent. A filing answering "N" is
 * NOT recorded: the row exists to state a succession, and the absence of one is
 * what every other filing already says.
 *
 * `predecessor_cik` is nullable because resolution can legitimately fail — the
 * acquired portal may pre-date EDGAR's funding-portal index, or the filer may
 * have typed a file number that never existed. The claim is kept either way;
 * guessing a CIK from the name is what this column exists not to do.
 */
export const PortalSuccessionSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  /** Position within `acquiredHistoryDetails` (the XSD allows up to five). */
  detail_index: Type.Integer(),
  /** The filer making the claim — the successor. */
  cik: TypeSecCik({ description: "CIK of the portal that filed this claim" }),
  /** Acquired portal's name as filed. Free text; never used to resolve a CIK. */
  predecessor_name: TypeNullable(Type.String({ maxLength: 300 })),
  /** Acquired portal's SEC file number, e.g. `007-00046`. The join key. */
  predecessor_file_number: TypeNullable(Type.String({ maxLength: 32 })),
  /** Resolved from {@link predecessor_file_number}; null when it did not resolve. */
  predecessor_cik: TypeNullable(TypeSecCik()),
  /** The filer's own free-text explanation (`acquiredDesc`, up to 4000 chars). */
  detail: TypeNullable(Type.String({ maxLength: 4000 })),
  filing_date: TypeNullable(Type.String({ format: "date" })),
  created_at: Type.String(),
});
export type PortalSuccession = Static<typeof PortalSuccessionSchema>;

export const PortalSuccessionPrimaryKeyNames = ["accession_number", "detail_index"] as const;

export type PortalSuccessionRepositoryStorage = ITabularStorage<
  typeof PortalSuccessionSchema,
  typeof PortalSuccessionPrimaryKeyNames,
  PortalSuccession
>;

export const PORTAL_SUCCESSION_REPOSITORY_TOKEN =
  createServiceToken<PortalSuccessionRepositoryStorage>("sec.storage.portalSuccessionRepository");
