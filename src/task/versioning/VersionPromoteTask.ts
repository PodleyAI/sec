/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, Task } from "workglow";
import { countEligibleDeadLetters } from "../../cli/groups/extractor";
import { promote } from "../../storage/versioning/ceremonies";
import type { ComponentKind } from "../../storage/versioning/ComponentVersionSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { VersionEventRepo } from "../../storage/versioning/VersionEventRepo";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "../../storage/versioning/VersionEventSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";

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
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    const events = new VersionEventRepo(globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN));
    const runs = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
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
