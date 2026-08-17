/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";

export const COMPONENT_KINDS = ["extractor", "resolver"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const COMPONENT_SLOTS = ["previous", "current", "next"] as const;
export type ComponentSlot = (typeof COMPONENT_SLOTS)[number];

export const BUMP_TYPES = ["major", "minor", "patch"] as const;
export type BumpType = (typeof BUMP_TYPES)[number];

export const ComponentVersionSchema = Type.Object({
  component_kind: Type.Union([Type.Literal("extractor"), Type.Literal("resolver")], {
    description: "Which subsystem this component belongs to",
  }),
  component_id: Type.String({
    maxLength: 64,
    description:
      "Form symbol (e.g. 'D', '1-A') for extractors, or domain name ('person', 'company') for resolvers",
  }),
  slot: Type.Union([Type.Literal("previous"), Type.Literal("current"), Type.Literal("next")], {
    description: "Which of the three slots this row occupies",
  }),
  semver: Type.String({
    maxLength: 32,
    description:
      "Semantic version, e.g. '2.1.0'. Validation enforced by VersionRegistry, not schema.",
  }),
  bump_type: Type.Union(
    [Type.Literal("major"), Type.Literal("minor"), Type.Literal("patch"), Type.Null()],
    {
      description: "Declared bump type for the next→current transition. Null on initial seed.",
    }
  ),
  started_at: Type.String({
    description: "ISO 8601 timestamp when this slot was populated",
  }),
  coverage_complete: Type.Boolean({
    description:
      "Whether the next slot has 100% coverage. Always true for current/previous. Gate for major-promote.",
  }),
  target_count: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], {
    description:
      "Snapshot of filings handled by this extractor at start-dev time. Populated only on next-slot rows with bump_type='major'; null elsewhere. Denominator for the major-promote coverage gate.",
  }),
});

export type ComponentVersion = Static<typeof ComponentVersionSchema>;

export const ComponentVersionPrimaryKeyNames = ["component_kind", "component_id", "slot"] as const;

export type ComponentVersionRepositoryStorage = ITabularStorage<
  typeof ComponentVersionSchema,
  typeof ComponentVersionPrimaryKeyNames,
  ComponentVersion
>;

export const COMPONENT_VERSION_REPOSITORY_TOKEN =
  createServiceToken<ComponentVersionRepositoryStorage>("sec.storage.componentVersionRepository");
