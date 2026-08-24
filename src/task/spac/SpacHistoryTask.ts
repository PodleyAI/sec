/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import type { SpacHistory } from "../../storage/spac/SpacHistorySchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";

export type SpacHistoryTaskInput = {
  readonly cik: number;
};

export type SpacHistoryTaskOutput = {
  readonly history: SpacHistory[];
};

/** Loads a SPAC's state-change history snapshots, ascending by valid_from. */
export class SpacHistoryTask extends Task<SpacHistoryTaskInput, SpacHistoryTaskOutput> {
  static readonly type = "SpacHistoryTask";
  static readonly category = "SEC";
  static readonly title = "SPAC state-change history";
  static readonly description = "Returns the recorded state-change history of one SPAC";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      cik: Type.Number(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      history: Type.Array(Type.Unknown()),
    });
  }

  async execute(input: SpacHistoryTaskInput): Promise<SpacHistoryTaskOutput> {
    return { history: await new SpacRepo().getHistory(input.cik) };
  }
}
