/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { getDbStats, type TableStat } from "../../cli/queries/DbStatus";

export type DbStatsTaskOutput = {
  readonly tables: TableStat[];
};

/** Reads per-table row counts for the database stats view. */
export class DbStatsTask extends Task<Record<string, never>, DbStatsTaskOutput> {
  static readonly type = "DbStatsTask";
  static readonly category = "SEC";
  static readonly title = "Database stats";
  static readonly cacheable = false;

  public static outputSchema() {
    return Type.Object({
      tables: Type.Array(Type.Object({ table: Type.String(), rows: Type.Number() })),
    });
  }

  async execute(): Promise<DbStatsTaskOutput> {
    return { tables: await getDbStats() };
  }
}
