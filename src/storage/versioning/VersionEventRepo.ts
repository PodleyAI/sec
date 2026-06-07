/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ComponentKind } from "./ComponentVersionSchema";
import type { VersionEvent, VersionEventRepositoryStorage } from "./VersionEventSchema";

/**
 * Append-only ceremony audit log. One row per start-dev / promote / rollback /
 * drop-next invocation. `id` is auto-assigned by the repo on insert; callers
 * never set it. `at_timestamp` is auto-assigned to now-ISO.
 *
 * The repo assumes single-process invocation (matches the CLI's existing
 * single-operator assumption). Two concurrent recordEvent calls could
 * theoretically race on id assignment; not a realistic concern for this CLI.
 *
 * Note: ids are assigned via storage.size() + 1. This is correct for an
 * append-only log but breaks if any consumer ever deletes rows from this
 * table (a delete-then-insert sequence will reuse the deleted id). This
 * repo never deletes events; future code that wants to garbage-collect old
 * audit rows MUST migrate to a stable id source (e.g. UUIDs) first.
 */
export class VersionEventRepo {
  constructor(private readonly storage: VersionEventRepositoryStorage) {}

  async recordEvent(event: Omit<VersionEvent, "id" | "at_timestamp">): Promise<void> {
    const size = (await this.storage.size()) ?? 0;
    await this.storage.put({
      ...event,
      id: size + 1,
      at_timestamp: new Date().toISOString(),
    } as VersionEvent);
  }

  async listForComponent(
    kind: ComponentKind,
    id: string,
    limit: number = 20
  ): Promise<VersionEvent[]> {
    const rows =
      (await this.storage.query({
        component_kind: kind,
        component_id: id,
      })) ?? [];
    // Newest first by at_timestamp; tie-break by id descending so within-second
    // ordering is deterministic.
    rows.sort((a, b) => {
      if (a.at_timestamp !== b.at_timestamp) {
        return a.at_timestamp < b.at_timestamp ? 1 : -1;
      }
      return b.id - a.id;
    });
    return rows.slice(0, limit);
  }
}
