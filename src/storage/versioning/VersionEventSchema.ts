/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";

export const VERSION_EVENT_TYPES = [
  "start-dev",
  "promote",
  "rollback",
  "drop-next",
  "drop-previous",
] as const;
export type VersionEventType = (typeof VERSION_EVENT_TYPES)[number];

export const VersionEventSchema = Type.Object({
  id: Type.Integer({
    description:
      "Sequential primary key, assigned by VersionEventRepo on insert via storage.size() + 1. The table is append-only by design; see VersionEventRepo JSDoc for the no-delete invariant.",
  }),
  component_kind: Type.Union([Type.Literal("extractor"), Type.Literal("resolver")], {
    description: "Which subsystem this event belongs to",
  }),
  component_id: Type.String({
    maxLength: 64,
    description: "Form symbol or domain name",
  }),
  event_type: Type.Union(
    [
      Type.Literal("start-dev"),
      Type.Literal("promote"),
      Type.Literal("rollback"),
      Type.Literal("drop-next"),
      Type.Literal("drop-previous"),
    ],
    { description: "Ceremony that produced this event" }
  ),
  from_semver: Type.Union([Type.String({ maxLength: 32 }), Type.Null()], {
    description: "Semver of the prior state (depends on event_type)",
  }),
  to_semver: Type.Union([Type.String({ maxLength: 32 }), Type.Null()], {
    description: "Semver of the resulting state (depends on event_type)",
  }),
  bump_type: Type.Union(
    [Type.Literal("major"), Type.Literal("minor"), Type.Literal("patch"), Type.Null()],
    { description: "Bump type associated with the event" }
  ),
  target_count: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], {
    description: "Snapshot count captured on major start-dev events; null otherwise",
  }),
  at_timestamp: Type.String({
    description: "ISO 8601 timestamp",
  }),
  notes: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()], {
    description: "Operator-supplied --notes annotation, if any",
  }),
});

export type VersionEvent = Static<typeof VersionEventSchema>;

export const VersionEventPrimaryKeyNames = ["id"] as const;

export type VersionEventRepositoryStorage = ITabularStorage<
  typeof VersionEventSchema,
  typeof VersionEventPrimaryKeyNames,
  VersionEvent
>;

export const VERSION_EVENT_REPOSITORY_TOKEN = createServiceToken<VersionEventRepositoryStorage>(
  "sec.storage.versionEventRepository"
);
