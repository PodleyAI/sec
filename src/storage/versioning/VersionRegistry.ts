/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ComponentKind,
  ComponentSlot,
  ComponentVersion,
  ComponentVersionRepositoryStorage,
} from "./ComponentVersionSchema";

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Validates MAJOR.MINOR.PATCH semver strings. Pre-release suffixes
 * (e.g. "1.0.0-alpha") and build metadata are intentionally unsupported in v1.
 */
export function isValidSemver(s: string): boolean {
  return SEMVER_RE.test(s);
}

export class VersionRegistry {
  constructor(private readonly storage: ComponentVersionRepositoryStorage) {}

  async getCurrent(kind: ComponentKind, id: string): Promise<ComponentVersion | undefined> {
    return this.getSlot(kind, id, "current");
  }

  async getPrevious(kind: ComponentKind, id: string): Promise<ComponentVersion | undefined> {
    return this.getSlot(kind, id, "previous");
  }

  async getNext(kind: ComponentKind, id: string): Promise<ComponentVersion | undefined> {
    return this.getSlot(kind, id, "next");
  }

  async putSlot(row: ComponentVersion): Promise<void> {
    if (!isValidSemver(row.semver)) {
      throw new Error(
        `VersionRegistry: invalid semver '${row.semver}' for ${row.component_kind}:${row.component_id} slot=${row.slot}`
      );
    }
    if (row.slot !== "next" && !row.coverage_complete) {
      throw new Error(
        `VersionRegistry: coverage_complete must be true for ${row.slot} slot (got false on ${row.component_kind}:${row.component_id})`
      );
    }
    if (row.target_count !== null && row.slot !== "next") {
      throw new Error(
        `VersionRegistry: target_count must be null for ${row.slot} slot (got ${row.target_count} on ${row.component_kind}:${row.component_id})`
      );
    }
    if (row.target_count !== null && row.bump_type !== "major") {
      throw new Error(
        `VersionRegistry: target_count is only meaningful for bump_type='major' (got ${row.target_count} with bump_type=${row.bump_type})`
      );
    }
    if (row.slot === "next" && row.bump_type === "major" && row.target_count === null) {
      throw new Error(
        `VersionRegistry: major bump in next slot requires non-null target_count (got null on ${row.component_kind}:${row.component_id})`
      );
    }
    await this.storage.put(row);
  }

  async clearSlot(kind: ComponentKind, id: string, slot: ComponentSlot): Promise<void> {
    await this.storage.delete({
      component_kind: kind,
      component_id: id,
      slot,
    });
  }

  async listAll(): Promise<ComponentVersion[]> {
    const rows = await this.storage.getAll();
    return rows ?? [];
  }

  async listByKind(kind: ComponentKind): Promise<ComponentVersion[]> {
    const rows = await this.storage.query({ component_kind: kind });
    return rows ?? [];
  }

  private async getSlot(
    kind: ComponentKind,
    id: string,
    slot: ComponentSlot
  ): Promise<ComponentVersion | undefined> {
    const rows = await this.storage.query({
      component_kind: kind,
      component_id: id,
      slot,
    });
    return rows?.[0];
  }
}
