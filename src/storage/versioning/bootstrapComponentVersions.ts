/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "./ComponentVersionSchema";
import type { ComponentKind } from "./ComponentVersionSchema";
import { EXTRACTOR_IDS } from "./extractorIds";
import { RESOLVER_IDS } from "../../resolver/resolverIds";
import { VersionRegistry } from "./VersionRegistry";

/**
 * Idempotently seeds component_versions.current = 1.0.0 for every known
 * extractor AND resolver id. Existing current slots are left untouched.
 */
export async function bootstrapComponentVersions(): Promise<void> {
  const reg = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const startedAt = new Date().toISOString();

  const tasks: ReadonlyArray<{ kind: ComponentKind; ids: ReadonlyArray<string> }> = [
    { kind: "extractor", ids: EXTRACTOR_IDS },
    { kind: "resolver", ids: RESOLVER_IDS },
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
