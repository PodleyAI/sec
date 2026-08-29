/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import {
  reconstructRosterCompleteness,
  type RosterCompletenessReconstruction,
} from "../../resolver/reconstructRosterCompleteness";
import type { TaskPorts } from "../taskPorts";

export type ReconstructRosterCompletenessTaskOutput = TaskPorts<RosterCompletenessReconstruction>;

/**
 * Recovers the roster completeness decisions that filings extracted before
 * `role_roster_completeness` existed acted on but never recorded, from the
 * closures they left in `person_role`.
 */
export class ReconstructRosterCompletenessTask extends Task<
  Record<string, never>,
  ReconstructRosterCompletenessTaskOutput
> {
  static readonly type = "ReconstructRosterCompletenessTask";
  static readonly category = "SEC";
  static readonly title = "Reconstruct roster completeness";
  static readonly cacheable = false;

  public static outputSchema() {
    return Type.Object({
      tenures: Type.Number(),
      closures: Type.Number(),
      written: Type.Number(),
      alreadyRecorded: Type.Number(),
      unattributed: Type.Number(),
    });
  }

  async execute(): Promise<ReconstructRosterCompletenessTaskOutput> {
    return await reconstructRosterCompleteness();
  }
}
