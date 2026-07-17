/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { getDbStatus, type DbStatusResult } from "../../cli/queries/DbStatus";
import type { TaskPorts } from "../taskPorts";

/** Reads headline row counts for the database status view. */
export class DbStatusTask extends Task<Record<string, never>, TaskPorts<DbStatusResult>> {
  static readonly type = "DbStatusTask";
  static readonly category = "SEC";
  static readonly title = "Database status";
  static readonly cacheable = false;

  public static outputSchema() {
    return Type.Object({
      entityCount: Type.Number(),
      filingCount: Type.Number(),
      factsCount: Type.Number(),
      processedSubmissions: Type.Number(),
      processedFacts: Type.Number(),
      extractorRuns: Type.Number(),
    });
  }

  async execute(): Promise<TaskPorts<DbStatusResult>> {
    return getDbStatus();
  }
}
