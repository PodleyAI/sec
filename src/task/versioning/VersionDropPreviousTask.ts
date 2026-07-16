/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, Task } from "workglow";
import { dropPrevious } from "../../storage/versioning/ceremonies";
import type { ComponentKind } from "../../storage/versioning/ComponentVersionSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { VersionEventRepo } from "../../storage/versioning/VersionEventRepo";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "../../storage/versioning/VersionEventSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";

export type VersionDropPreviousTaskInput = {
  readonly kind: ComponentKind;
  readonly id: string;
  readonly notes: string | null;
  readonly dryRun: boolean;
};

export type VersionDropPreviousTaskOutput = {
  readonly success: boolean;
};

/**
 * Runs the drop-previous ceremony: clears the previous slot and purges the
 * data associated with that version (extractor runs, or resolver
 * identity-link/canonical rows).
 */
export class VersionDropPreviousTask extends Task<
  VersionDropPreviousTaskInput,
  VersionDropPreviousTaskOutput
> {
  static readonly type = "VersionDropPreviousTask";
  static readonly category = "SEC";
  static readonly title = "Version drop-previous";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: Type.Union([Type.Literal("extractor"), Type.Literal("resolver")]),
      id: Type.String(),
      notes: Type.Union([Type.String(), Type.Null()]),
      dryRun: Type.Boolean(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(input: VersionDropPreviousTaskInput): Promise<VersionDropPreviousTaskOutput> {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    const events = new VersionEventRepo(globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN));
    const runs =
      input.kind === "extractor"
        ? new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN))
        : undefined;
    await dropPrevious({
      reg,
      events,
      kind: input.kind,
      id: input.id,
      notes: input.notes,
      dryRun: input.dryRun,
      runs,
    });
    return { success: true };
  }
}
