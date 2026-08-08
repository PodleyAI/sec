/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { Task } from "workglow";
import { getDbStatus, type DbStatusResult } from "../../cli/queries/DbStatus";
import type { TaskPorts } from "../taskPorts";

const InputSchema = () => Type.Object({ exact: Type.Optional(Type.Boolean({ default: false })) });
type DbStatusTaskInput = Static<ReturnType<typeof InputSchema>>;

/** Reads headline row counts for the database status view. */
export class DbStatusTask extends Task<DbStatusTaskInput, TaskPorts<DbStatusResult>> {
  static readonly type = "DbStatusTask";
  static readonly category = "SEC";
  static readonly title = "Database status";
  static readonly cacheable = false;

  public static inputSchema() {
    return InputSchema();
  }

  public static outputSchema() {
    return Type.Object({
      entityCount: Type.Number(),
      filingCount: Type.Number(),
      factsCount: Type.Number(),
      processedSubmissions: Type.Number(),
      processedFacts: Type.Number(),
      extractorRuns: Type.Number(),
      // True when any count above is a Postgres `n_live_tup` estimate.
      estimated: Type.Boolean(),
    });
  }

  async execute(input: DbStatusTaskInput): Promise<TaskPorts<DbStatusResult>> {
    return getDbStatus({ exact: input.exact === true });
  }
}
