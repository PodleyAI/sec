/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { countEligibleDeadLetters } from "../forms/ListDeadLettersTask";
import { promote } from "../../storage/versioning/ceremonies";
import type { ComponentKind } from "../../storage/versioning/ComponentVersionSchema";
import { ceremonyExtractorRuns, ceremonyRepos } from "./ceremonyRepos";

export type VersionPromoteTaskInput = {
  readonly kind: ComponentKind;
  readonly id: string;
  readonly force: boolean;
  readonly notes: string | null;
  readonly dryRun: boolean;
};

export type VersionPromoteTaskOutput = {
  /**
   * Pending dead-letter entries that became eligible for retry under the newly
   * promoted version. Computed for extractor kind on non-dry runs; 0 otherwise.
   */
  readonly eligibleDeadLetters: number;
};

/** Runs the promote ceremony: rotates next → current → previous. */
export class VersionPromoteTask extends Task<VersionPromoteTaskInput, VersionPromoteTaskOutput> {
  static readonly type = "VersionPromoteTask";
  static readonly category = "SEC";
  static readonly title = "Version promote";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: Type.Union([Type.Literal("extractor"), Type.Literal("resolver")]),
      id: Type.String(),
      force: Type.Boolean(),
      notes: Type.Union([Type.String(), Type.Null()]),
      dryRun: Type.Boolean(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      eligibleDeadLetters: Type.Number(),
    });
  }

  async execute(input: VersionPromoteTaskInput): Promise<VersionPromoteTaskOutput> {
    const { reg, events } = ceremonyRepos();
    const runs = ceremonyExtractorRuns();
    await promote({
      reg,
      events,
      runs,
      kind: input.kind,
      id: input.id,
      force: input.force,
      notes: input.notes,
      dryRun: input.dryRun,
    });
    const eligibleDeadLetters =
      !input.dryRun && input.kind === "extractor" ? await countEligibleDeadLetters(input.id) : 0;
    return { eligibleDeadLetters };
  }
}
