/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { Task } from "workglow";
import { resetAllDatabases } from "../../config/resetAllDatabases";
import { setupAllDatabases } from "../../config/setupAllDatabases";

const InputSchema = () =>
  Type.Object({
    cascade: Type.Optional(
      Type.Boolean({ default: false, description: "Also drop objects that depend on sec's tables" })
    ),
    dropSchema: Type.Optional(
      Type.Boolean({
        default: false,
        description: "Postgres only: drop and recreate the whole schema, owned or not",
      })
    ),
  });
export type DbResetTaskInput = Static<ReturnType<typeof InputSchema>>;

export type DbResetTaskOutput = {
  readonly success: boolean;
};

/** Drops and recreates the tables sec owns. Destructive — the CLI gates it behind --confirm. */
export class DbResetTask extends Task<DbResetTaskInput, DbResetTaskOutput> {
  static readonly type = "DbResetTask";
  static readonly category = "SEC";
  static readonly title = "Reset database";
  static readonly cacheable = false;

  public static inputSchema() {
    return InputSchema();
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(input: DbResetTaskInput): Promise<DbResetTaskOutput> {
    await resetAllDatabases({
      cascade: input.cascade === true,
      dropSchema: input.dropSchema === true,
    });
    await setupAllDatabases();
    return { success: true };
  }
}
