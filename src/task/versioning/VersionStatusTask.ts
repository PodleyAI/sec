/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { getVersionStatus, type VersionStatusRow } from "../../cli/queries/VersionStatus";

export type VersionStatusTaskInput = Record<string, never>;

export type VersionStatusTaskOutput = {
  readonly rows: VersionStatusRow[];
};

/** Reports the previous/current/next slot semver of every registered component. */
export class VersionStatusTask extends Task<VersionStatusTaskInput, VersionStatusTaskOutput> {
  static readonly type = "VersionStatusTask";
  static readonly category = "SEC";
  static readonly title = "Version status";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({});
  }

  public static outputSchema() {
    return Type.Object({
      rows: Type.Array(
        Type.Object({
          component_kind: Type.Union([Type.Literal("extractor"), Type.Literal("resolver")]),
          component_id: Type.String(),
          previous: Type.String(),
          current: Type.String(),
          next: Type.String(),
          next_coverage_complete: Type.Boolean(),
        })
      ),
    });
  }

  async execute(): Promise<VersionStatusTaskOutput> {
    return { rows: await getVersionStatus() };
  }
}
