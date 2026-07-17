/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { getVersionCoverage, type VersionCoverageResult } from "../../cli/queries/VersionCoverage";
import type { ComponentKind } from "../../storage/versioning/ComponentVersionSchema";
import type { TaskPorts } from "../taskPorts";

export type VersionCoverageTaskInput = {
  readonly kind: ComponentKind;
  readonly id: string;
};

/** Reports major-promote coverage for an extractor's in-flight dev cycle. */
export class VersionCoverageTask extends Task<
  VersionCoverageTaskInput,
  TaskPorts<VersionCoverageResult>
> {
  static readonly type = "VersionCoverageTask";
  static readonly category = "SEC";
  static readonly title = "Version coverage";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: Type.Union([Type.Literal("extractor"), Type.Literal("resolver")]),
      id: Type.String(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      component_kind: Type.Union([Type.Literal("extractor"), Type.Literal("resolver")]),
      component_id: Type.String(),
      status: Type.String(),
      next_semver: Type.Union([Type.String(), Type.Null()]),
      bump_type: Type.Union([Type.String(), Type.Null()]),
      target_count: Type.Union([Type.Number(), Type.Null()]),
      successful_count: Type.Union([Type.Number(), Type.Null()]),
      percent: Type.Union([Type.Number(), Type.Null()]),
    });
  }

  async execute(input: VersionCoverageTaskInput): Promise<TaskPorts<VersionCoverageResult>> {
    return getVersionCoverage(input.kind, input.id);
  }
}
