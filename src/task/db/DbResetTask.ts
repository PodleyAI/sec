/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { resetAllDatabases } from "../../config/resetAllDatabases";
import { setupAllDatabases } from "../../config/setupAllDatabases";

export type DbResetTaskOutput = {
  readonly success: boolean;
};

/** Drops and recreates all database tables. Destructive — the CLI gates it behind --confirm. */
export class DbResetTask extends Task<Record<string, never>, DbResetTaskOutput> {
  static readonly type = "DbResetTask";
  static readonly category = "SEC";
  static readonly title = "Reset database";
  static readonly cacheable = false;

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(): Promise<DbResetTaskOutput> {
    await resetAllDatabases();
    await setupAllDatabases();
    return { success: true };
  }
}
