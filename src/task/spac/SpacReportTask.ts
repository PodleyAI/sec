/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import type { TaskPorts } from "../taskPorts";
import { assembleSpacReport, type SpacReport } from "../../commands/spac";

export type SpacReportTaskInput = {
  readonly cik: number;
};

/** Assembles the consolidated SPAC report (row + deals + events + link counts) for a CIK. */
export class SpacReportTask extends Task<SpacReportTaskInput, TaskPorts<SpacReport>> {
  static readonly type = "SpacReportTask";
  static readonly category = "SEC";
  static readonly title = "SPAC consolidated report";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      cik: Type.Number(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      cik: Type.Number(),
      spac: Type.Optional(Type.Unknown()),
      deals: Type.Array(Type.Unknown()),
      events: Type.Array(Type.Unknown()),
      sponsorCount: Type.Number(),
      underwriterCount: Type.Number(),
    });
  }

  async execute(input: SpacReportTaskInput): Promise<TaskPorts<SpacReport>> {
    return assembleSpacReport(input.cik);
  }
}
