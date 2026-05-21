/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  COMPONENT_VERSION_REPOSITORY_TOKEN,
  ComponentKind,
} from "../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";

export interface VersionStatusRow {
  readonly component_kind: ComponentKind;
  readonly component_id: string;
  readonly previous: string;
  readonly current: string;
  readonly next: string;
  readonly next_coverage_complete: boolean;
}

export async function getVersionStatus(): Promise<VersionStatusRow[]> {
  const reg = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const rows = await reg.listAll();

  const grouped = new Map<string, VersionStatusRow>();
  const keyFor = (kind: ComponentKind, id: string): string => `${kind}::${id}`;
  const emptyRow = (kind: ComponentKind, id: string): VersionStatusRow => ({
    component_kind: kind,
    component_id: id,
    previous: "—",
    current: "—",
    next: "—",
    next_coverage_complete: false,
  });

  for (const row of rows) {
    const key = keyFor(row.component_kind, row.component_id);
    const acc = grouped.get(key) ?? emptyRow(row.component_kind, row.component_id);
    if (row.slot === "previous") {
      grouped.set(key, { ...acc, previous: row.semver });
    } else if (row.slot === "current") {
      grouped.set(key, { ...acc, current: row.semver });
    } else if (row.slot === "next") {
      grouped.set(key, {
        ...acc,
        next: row.coverage_complete
          ? `${row.semver} (ready)`
          : `${row.semver} (in progress)`,
        next_coverage_complete: row.coverage_complete,
      });
    }
  }

  return [...grouped.values()].sort((a, b) => {
    if (a.component_kind !== b.component_kind) {
      return a.component_kind < b.component_kind ? -1 : 1;
    }
    return a.component_id < b.component_id ? -1 : 1;
  });
}
