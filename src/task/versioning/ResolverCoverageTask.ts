/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, Task } from "workglow";
import {
  computeResolverCoverage,
  type ResolverCoverageResult,
} from "../../cli/queries/ResolverCoverage";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import type { TaskPorts } from "../taskPorts";

export type ResolverCoverageTaskInput = {
  readonly id: string;
};

/**
 * Reports identity-link coverage for a resolver at its active slot version
 * (next if a dev cycle is in flight, else current).
 */
export class ResolverCoverageTask extends Task<
  ResolverCoverageTaskInput,
  TaskPorts<ResolverCoverageResult>
> {
  static readonly type = "ResolverCoverageTask";
  static readonly category = "SEC";
  static readonly title = "Resolver coverage";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      id: Type.String(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      kind: Type.String(),
      resolver_version: Type.String(),
      numerator: Type.Number(),
      denominator: Type.Number(),
      fraction: Type.Number(),
    });
  }

  async execute(input: ResolverCoverageTaskInput): Promise<TaskPorts<ResolverCoverageResult>> {
    const versionRegistry = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    const slot = await getActiveSlot(versionRegistry, "resolver", input.id);
    if (!slot) {
      throw new Error(`No active slot for resolver:${input.id}`);
    }
    return computeResolverCoverage(input.id, slot.semver);
  }
}
