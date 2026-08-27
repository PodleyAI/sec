/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "./ComponentVersionSchema";
import type { ComponentKind } from "./ComponentVersionSchema";
import { resolverIds } from "../../resolver/resolverIds";
import { VersionRegistry } from "./VersionRegistry";

/**
 * Idempotently seeds component_versions.current = 1.0.0 for every extractor id
 * in `extractorIds` AND every known resolver id. Existing current slots are
 * left untouched.
 *
 * The extractor ids are a PARAMETER, not something this module enumerates.
 * They come from an open registry a downstream package registers into, and
 * this module sits underneath that registry: `extractorIds.ts` next door is
 * imported by the `.storage.ts` handlers the registrations are built from, so
 * enumerating from here would put the forms tier inside this tier's import
 * closure and leave the one call that must never appear in that closure — the
 * module-scope registration — a single edit away. Taking the ids as an
 * argument makes that dependency impossible to add by accident, and makes
 * "the registry is populated" the caller's visible obligation rather than an
 * unstated precondition of this function.
 *
 * Seeding an id twice is harmless, so a caller may pass ids that overlap.
 */
export async function bootstrapComponentVersions(extractorIds: readonly string[]): Promise<void> {
  const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
  const startedAt = new Date().toISOString();

  const tasks: ReadonlyArray<{ kind: ComponentKind; ids: ReadonlyArray<string> }> = [
    { kind: "extractor", ids: extractorIds },
    { kind: "resolver", ids: resolverIds() },
  ];

  for (const { kind, ids } of tasks) {
    for (const id of ids) {
      const existing = await reg.getCurrent(kind, id);
      if (existing) continue;
      await reg.putSlot({
        component_kind: kind,
        component_id: id,
        slot: "current",
        semver: "1.0.0",
        bump_type: null,
        started_at: startedAt,
        coverage_complete: true,
        target_count: null,
      });
    }
  }
}
