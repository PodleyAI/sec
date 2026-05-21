/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type { ComponentKind } from "../../storage/versioning/ComponentVersionSchema";
import type { VersionEvent } from "../../storage/versioning/VersionEventSchema";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "../../storage/versioning/VersionEventSchema";
import { VersionEventRepo } from "../../storage/versioning/VersionEventRepo";

export async function getVersionHistory(
  kind: ComponentKind,
  id: string,
  limit: number = 20
): Promise<VersionEvent[]> {
  const repo = new VersionEventRepo(
    globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN)
  );
  return repo.listForComponent(kind, id, limit);
}
