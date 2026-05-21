/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "./ComponentVersionSchema";
import { EXTRACTOR_IDS } from "./extractorIds";
import { VersionRegistry } from "./VersionRegistry";

/**
 * Idempotently seeds component_versions.current = 1.0.0 for every known
 * extractor id. Existing current slots are left untouched.
 */
export async function bootstrapExtractorVersions(): Promise<void> {
  const reg = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const startedAt = new Date().toISOString();

  for (const id of EXTRACTOR_IDS) {
    const existing = await reg.getCurrent("extractor", id);
    if (existing) continue;
    await reg.putSlot({
      component_kind: "extractor",
      component_id: id,
      slot: "current",
      semver: "1.0.0",
      bump_type: null,
      started_at: startedAt,
      coverage_complete: true,
    });
  }
}
