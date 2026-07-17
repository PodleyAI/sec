/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { dropPrevious } from "../../storage/versioning/ceremonies";
import type { ComponentKind } from "../../storage/versioning/ComponentVersionSchema";
import { ceremonyExtractorRuns, ceremonyRepos } from "./ceremonyRepos";

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
    const { reg, events } = ceremonyRepos();
    const runs = input.kind === "extractor" ? ceremonyExtractorRuns() : undefined;
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
