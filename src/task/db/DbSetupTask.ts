/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";

export type DbSetupTaskOutput = {
  readonly success: boolean;
};

/** Creates or migrates all database tables. */
export class DbSetupTask extends Task<Record<string, never>, DbSetupTaskOutput> {
  static readonly type = "DbSetupTask";
  static readonly category = "SEC";
  static readonly title = "Set up database tables";
  static readonly cacheable = false;

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(): Promise<DbSetupTaskOutput> {
    await setupAllDatabases();
    return { success: true };
  }
}
