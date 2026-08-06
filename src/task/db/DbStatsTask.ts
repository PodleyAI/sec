/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { IExecuteContext, Task } from "workglow";
import { getDbStats, type TableStat } from "../../cli/queries/DbStatus";

export type DbStatsTaskOutput = {
  readonly tables: TableStat[];
};

const InputSchema = () => Type.Object({ exact: Type.Optional(Type.Boolean({ default: false })) });
type DbStatsTaskInput = Static<ReturnType<typeof InputSchema>>;

/** Reads per-table row counts for the database stats view. */
export class DbStatsTask extends Task<DbStatsTaskInput, DbStatsTaskOutput> {
  static readonly type = "DbStatsTask";
  static readonly category = "SEC";
  static readonly title = "Database stats";
  static readonly cacheable = false;

  public static inputSchema() {
    return InputSchema();
  }

  public static outputSchema() {
    return Type.Object({
      tables: Type.Array(Type.Object({ table: Type.String(), rows: Type.Number() })),
    });
  }

  async execute(input: DbStatsTaskInput, context: IExecuteContext): Promise<DbStatsTaskOutput> {
    return {
      tables: await getDbStats(
        (progress, message) => context.updateProgress(progress, message),
        { exact: input.exact === true }
      ),
    };
  }
}
