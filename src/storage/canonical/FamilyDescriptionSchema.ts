/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeStringEnum } from "../../util/TypeBoxUtil";

/** The two family tiers a description can attach to. */
export const FAMILY_DESCRIPTION_KINDS = ["sponsor-family", "underwriter-family"] as const;
export type FamilyDescriptionKind = (typeof FAMILY_DESCRIPTION_KINDS)[number];

/**
 * Editorial, manually-curated narrative description for a sponsor / underwriter
 * *family*. Deliberately **version-independent** — keyed by the normalized family
 * name, NOT the resolver-minted `canonical_*_family_id`, because those rows are
 * re-minted and purged per resolver version (`dropPrevious`). Keeping the
 * description here decouples the curated text from the resolver lifecycle so a
 * version bump never wipes it. Not SEC-sourced; populated via the CLI.
 */
export const FamilyDescriptionSchema = Type.Object({
  family_kind: TypeStringEnum(FAMILY_DESCRIPTION_KINDS, {
    description: "sponsor-family | underwriter-family",
  }),
  normalized_name: Type.String({
    maxLength: 512,
    description: "Normalized family name (same normalizer the resolvers/CLI use)",
  }),
  description: Type.String({ description: "Editorial narrative description" }),
  updated_at: Type.String({ format: "date-time" }),
});

export type FamilyDescription = Static<typeof FamilyDescriptionSchema>;

export const FamilyDescriptionPrimaryKeyNames = ["family_kind", "normalized_name"] as const;
export type FamilyDescriptionRepositoryStorage = ITabularStorage<
  typeof FamilyDescriptionSchema,
  typeof FamilyDescriptionPrimaryKeyNames,
  FamilyDescription
>;

export const FAMILY_DESCRIPTION_REPOSITORY_TOKEN =
  createServiceToken<FamilyDescriptionRepositoryStorage>("sec.storage.familyDescriptionRepository");
