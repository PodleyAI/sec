/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { getVersionHistory } from "../../cli/queries/VersionHistory";
import type { ComponentKind } from "../../storage/versioning/ComponentVersionSchema";
import { VersionEventSchema, type VersionEvent } from "../../storage/versioning/VersionEventSchema";

export type VersionHistoryTaskInput = {
  readonly kind: ComponentKind;
  readonly id: string;
  readonly limit: number;
};

export type VersionHistoryTaskOutput = {
  readonly events: VersionEvent[];
};

/** Lists the most recent ceremony events for a component, newest first. */
export class VersionHistoryTask extends Task<VersionHistoryTaskInput, VersionHistoryTaskOutput> {
  static readonly type = "VersionHistoryTask";
  static readonly category = "SEC";
  static readonly title = "Version history";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: Type.Union([Type.Literal("extractor"), Type.Literal("resolver")]),
      id: Type.String(),
      limit: Type.Number(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      events: Type.Array(VersionEventSchema),
    });
  }

  async execute(input: VersionHistoryTaskInput): Promise<VersionHistoryTaskOutput> {
    return { events: await getVersionHistory(input.kind, input.id, input.limit) };
  }
}
