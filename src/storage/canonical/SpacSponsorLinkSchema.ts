/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";

/** Per-filing fact: a SPAC issuer (raw CIK) is backed by a legal sponsor + family. */
export const SpacSponsorLinkSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  extractor_id: Type.String({ maxLength: 16 }),
  observation_index: Type.Integer(),
  issuer_cik: TypeSecCik(),
  sponsor_canonical_company_id: Type.String({ maxLength: 36 }),
  sponsor_family_id: Type.String({ maxLength: 36 }),
  resolver_version: Type.String({ maxLength: 32 }),
});
export type SpacSponsorLink = Static<typeof SpacSponsorLinkSchema>;

export const SpacSponsorLinkPrimaryKeyNames = [
  "accession_number",
  "extractor_id",
  "observation_index",
] as const;

export type SpacSponsorLinkRepositoryStorage = ITabularStorage<
  typeof SpacSponsorLinkSchema,
  typeof SpacSponsorLinkPrimaryKeyNames,
  SpacSponsorLink
>;

export const SPAC_SPONSOR_LINK_REPOSITORY_TOKEN =
  createServiceToken<SpacSponsorLinkRepositoryStorage>("sec.storage.spacSponsorLinkRepository");
