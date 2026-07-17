/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { dropNext } from "../../storage/versioning/ceremonies";
import type { ComponentKind } from "../../storage/versioning/ComponentVersionSchema";
import { ceremonyRepos } from "./ceremonyRepos";

export type VersionDropNextTaskInput = {
  readonly kind: ComponentKind;
  readonly id: string;
  readonly notes: string | null;
  readonly dryRun: boolean;
};

export type VersionDropNextTaskOutput = {
  readonly success: boolean;
};

/** Runs the drop-next ceremony: discards the in-flight dev cycle. */
export class VersionDropNextTask extends Task<VersionDropNextTaskInput, VersionDropNextTaskOutput> {
  static readonly type = "VersionDropNextTask";
  static readonly category = "SEC";
  static readonly title = "Version drop-next";
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

  async execute(input: VersionDropNextTaskInput): Promise<VersionDropNextTaskOutput> {
    const { reg, events } = ceremonyRepos();
    await dropNext({
      reg,
      events,
      kind: input.kind,
      id: input.id,
      notes: input.notes,
      dryRun: input.dryRun,
    });
    return { success: true };
  }
}
