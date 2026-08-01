/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";

/**
 * One row per single title a person observation claims — the per-filing raw
 * assertion "this filing says this person holds this title". A person with
 * several titles yields several rows; there are no title arrays in storage.
 * The title text IS the row's identity within its observation (the whole
 * row is the PK), so replays and concurrent writers converge on the same
 * rows and a reordered re-observation is a no-op — source order carries no
 * meaning across filings and is not stored. Rows whose title a
 * re-observation no longer asserts are deleted (a title list is the claim
 * of one filing, with no cross-filing accumulation), and all rows die with
 * a reaped observation. Uniqueness at the PK is case-sensitive; the repo's
 * case-insensitive de-duplication keeps "CEO"/"ceo" from becoming two rows.
 */
export const PersonObservationTitleSchema = Type.Object({
  observation_id: Type.Integer({
    description: "FK → person_observations.observation_id",
  }),
  title: Type.String({
    maxLength: 256,
    description: "A single title/role as the filing states it (e.g. 'Chief Executive Officer')",
  }),
});

export type PersonObservationTitle = Static<typeof PersonObservationTitleSchema>;

export const PersonObservationTitlePrimaryKeyNames = ["observation_id", "title"] as const;

export type PersonObservationTitleRepositoryStorage = ITabularStorage<
  typeof PersonObservationTitleSchema,
  typeof PersonObservationTitlePrimaryKeyNames,
  PersonObservationTitle
>;

export const PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN =
  createServiceToken<PersonObservationTitleRepositoryStorage>(
    "sec.storage.personObservationTitleRepository"
  );
