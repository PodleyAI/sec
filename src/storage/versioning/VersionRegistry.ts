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

export function isValidSemver(s: string): boolean {
  return SEMVER_RE.test(s);
}

export class VersionRegistry {
  constructor(private readonly storage: ComponentVersionRepositoryStorage) {}

  async getCurrent(
    kind: ComponentKind,
    id: string
  ): Promise<ComponentVersion | undefined> {
    return this.getSlot(kind, id, "current");
  }

  async getPrevious(
    kind: ComponentKind,
    id: string
  ): Promise<ComponentVersion | undefined> {
    return this.getSlot(kind, id, "previous");
  }

  async getNext(
    kind: ComponentKind,
    id: string
  ): Promise<ComponentVersion | undefined> {
    return this.getSlot(kind, id, "next");
  }

  async putSlot(row: ComponentVersion): Promise<void> {
    await this.storage.put(row);
  }

  async clearSlot(
    kind: ComponentKind,
    id: string,
    slot: ComponentSlot
  ): Promise<void> {
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
