/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, Task } from "workglow";
import { rollback } from "../../storage/versioning/ceremonies";
import type { ComponentKind } from "../../storage/versioning/ComponentVersionSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { VersionEventRepo } from "../../storage/versioning/VersionEventRepo";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "../../storage/versioning/VersionEventSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";

export type VersionRollbackTaskInput = {
  readonly kind: ComponentKind;
  readonly id: string;
  readonly notes: string | null;
  readonly dryRun: boolean;
};

export type VersionRollbackTaskOutput = {
  readonly success: boolean;
};

/** Runs the rollback ceremony: swaps the current and previous slots. */
export class VersionRollbackTask extends Task<VersionRollbackTaskInput, VersionRollbackTaskOutput> {
  static readonly type = "VersionRollbackTask";
  static readonly category = "SEC";
  static readonly title = "Version rollback";
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

  async execute(input: VersionRollbackTaskInput): Promise<VersionRollbackTaskOutput> {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    const events = new VersionEventRepo(globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN));
    await rollback({
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
