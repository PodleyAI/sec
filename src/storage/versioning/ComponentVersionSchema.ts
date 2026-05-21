/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";

// Helper to derive a Type.Union of literals from a const string tuple.
// We use a runtime `as any` because TypeBox's TUnion typing on dynamic
// literal arrays loses precision; the Static<> output is still correct.
function literalUnion<T extends readonly string[]>(
  values: T,
  options?: { description?: string }
) {
  return Type.Union(
    values.map((v) => Type.Literal(v)),
    options as any
  ) as any;
}

export const COMPONENT_KINDS = ["extractor", "resolver"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const COMPONENT_SLOTS = ["previous", "current", "next"] as const;
export type ComponentSlot = (typeof COMPONENT_SLOTS)[number];

export const BUMP_TYPES = ["major", "minor", "patch"] as const;
export type BumpType = (typeof BUMP_TYPES)[number];

export const ComponentVersionSchema = Type.Object({
  component_kind: literalUnion(COMPONENT_KINDS, {
    description: "Which subsystem this component belongs to",
  }),
  component_id: Type.String({
    maxLength: 64,
    description:
      "Form symbol (e.g. 'D', '1-A') for extractors, or domain name ('person', 'company') for resolvers",
  }),
  slot: literalUnion(COMPONENT_SLOTS, {
    description: "Which of the three slots this row occupies",
  }),
  semver: Type.String({
    maxLength: 32,
    description:
      "Semantic version, e.g. '2.1.0'. Validation enforced by VersionRegistry, not schema.",
  }),
  bump_type: Type.Union(
    [...BUMP_TYPES.map((v) => Type.Literal(v)), Type.Null()],
    {
      description:
        "Declared bump type for the next→current transition. Null on initial seed.",
    }
  ) as any,
  started_at: Type.String({
    description: "ISO 8601 timestamp when this slot was populated",
  }),
  coverage_complete: Type.Boolean({
    description:
      "Whether the next slot has 100% coverage. Always true for current/previous. Gate for major-promote.",
  }),
});

export type ComponentVersion = Static<typeof ComponentVersionSchema>;

export const ComponentVersionPrimaryKeyNames = [
  "component_kind",
  "component_id",
  "slot",
] as const;

export type ComponentVersionRepositoryStorage = ITabularStorage<
  typeof ComponentVersionSchema,
  typeof ComponentVersionPrimaryKeyNames,
  ComponentVersion
>;

export const COMPONENT_VERSION_REPOSITORY_TOKEN =
  createServiceToken<ComponentVersionRepositoryStorage>(
    "sec.storage.componentVersionRepository"
  );
