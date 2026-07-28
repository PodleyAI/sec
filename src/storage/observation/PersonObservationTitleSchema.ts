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
 * Rows are replaced wholesale when their observation is re-upserted (a title
 * list is the claim of one filing, with no cross-filing accumulation), and
 * deleted when the observation is reaped.
 */
export const PersonObservationTitleSchema = Type.Object({
  observation_id: Type.Integer({
    description: "FK → person_observations.observation_id",
  }),
  title_index: Type.Integer({
    minimum: 0,
    description: "Stable ordinal within the observation (source order)",
  }),
  title: Type.String({
    maxLength: 256,
    description: "A single title/role as the filing states it (e.g. 'Chief Executive Officer')",
  }),
});

export type PersonObservationTitle = Static<typeof PersonObservationTitleSchema>;

export const PersonObservationTitlePrimaryKeyNames = ["observation_id", "title_index"] as const;

export type PersonObservationTitleRepositoryStorage = ITabularStorage<
  typeof PersonObservationTitleSchema,
  typeof PersonObservationTitlePrimaryKeyNames,
  PersonObservationTitle
>;

export const PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN =
  createServiceToken<PersonObservationTitleRepositoryStorage>(
    "sec.storage.personObservationTitleRepository"
  );
