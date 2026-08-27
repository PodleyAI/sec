/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../util/TypeSecCik";

/**
 * One row per roster closure decision: whether the list one filing carried for
 * one `(extractor_id, role_scope)` at one company was the COMPLETE set of role
 * holders, or only part of it.
 *
 * The row exists because the decision is otherwise unrecoverable. A person the
 * extractor declines — a junk name field, an overlong name, a row under a
 * confidence floor — never reaches `observePerson`, so no observation records
 * that the filing named them. A later pass reading the stored observations
 * therefore sees a roster that looks whole, and closing from it would end the
 * roles of everyone the dropped row still asserted. That is a departure the
 * filing never evidenced, and nothing downstream can tell it from a real one.
 *
 * The key is the tuple closure itself runs on, and the row carries the date
 * the closure ran with, so the decision reads on its own without joining back
 * to `filings`.
 *
 * Not resolver-versioned: this is a property of the FILING's extraction, not
 * of any canonical-identity generation. It survives a re-key ceremony (whose
 * re-extraction rewrites it) rather than being rebuilt per resolver version.
 */
export const RoleRosterCompletenessSchema = Type.Object({
  accession_number: Type.String({ maxLength: 32 }),
  extractor_id: Type.String({
    maxLength: 16,
    description: "Form-mapped extractor id whose roster this decision is about",
  }),
  role_scope: Type.String({
    maxLength: 64,
    description: "Which list within the extractor (e.g. 'form-d:related-person', 's1:management')",
  }),
  company_cik: TypeSecCik({
    description: "CIK of the company the roster lists role holders for",
  }),
  filing_date: Type.String({
    maxLength: 10,
    description: "ISO filing date the closure ran with; empty when the filing carries none",
  }),
  complete: Type.Boolean({
    description: "True when the filing's extracted roster named every role holder it lists",
  }),
});

export type RoleRosterCompleteness = Static<typeof RoleRosterCompletenessSchema>;

export const RoleRosterCompletenessPrimaryKeyNames = [
  "accession_number",
  "extractor_id",
  "role_scope",
  "company_cik",
] as const;

export type RoleRosterCompletenessRepositoryStorage = ITabularStorage<
  typeof RoleRosterCompletenessSchema,
  typeof RoleRosterCompletenessPrimaryKeyNames,
  RoleRosterCompleteness
>;

export const ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN =
  createServiceToken<RoleRosterCompletenessRepositoryStorage>(
    "sec.storage.roleRosterCompletenessRepository"
  );
