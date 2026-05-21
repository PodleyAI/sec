/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type { ComponentKind } from "../../storage/versioning/ComponentVersionSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";

export interface VersionCoverageResult {
  readonly component_kind: ComponentKind;
  readonly component_id: string;
  readonly status: string;
  readonly next_semver: string | null;
  readonly bump_type: string | null;
  readonly target_count: number | null;
  readonly successful_count: number | null;
  readonly percent: number | null;
}

export async function getVersionCoverage(
  kind: ComponentKind,
  id: string
): Promise<VersionCoverageResult> {
  const reg = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const runs = new ExtractorRunRepo(
    globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
  );

  const next = await reg.getNext(kind, id);
  if (!next) {
    return {
      component_kind: kind,
      component_id: id,
      status: "no dev cycle in flight",
      next_semver: null,
      bump_type: null,
      target_count: null,
      successful_count: null,
      percent: null,
    };
  }

  if (next.bump_type !== "major") {
    return {
      component_kind: kind,
      component_id: id,
      status: `no coverage gate (bump_type=${next.bump_type})`,
      next_semver: next.semver,
      bump_type: next.bump_type,
      target_count: null,
      successful_count: null,
      percent: null,
    };
  }

  const target = next.target_count ?? 0;
  const successful = await runs.countSuccessfulAtVersion(id, next.semver);
  const percent = target === 0 ? 100 : Math.round((successful / target) * 10000) / 100;

  let status: string;
  if (target === 0) status = "ready to promote (target_count=0)";
  else if (successful >= target) status = "ready to promote";
  else status = "in progress";

  return {
    component_kind: kind,
    component_id: id,
    status,
    next_semver: next.semver,
    bump_type: next.bump_type,
    target_count: target,
    successful_count: successful,
    percent,
  };
}
