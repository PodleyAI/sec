/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, Task } from "workglow";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import {
  ExtractionDeadLetterSchema,
  type ExtractionDeadLetter,
} from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";

/** Number of pending dead-letter entries now eligible under the current version. */
export async function countEligibleDeadLetters(extractorId: string): Promise<number> {
  const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
  const slot = await getActiveSlot(reg, "extractor", extractorId);
  if (!slot) return 0;
  return new ExtractionDeadLetterRepo().countEligible(extractorId, slot.semver);
}

export type ListDeadLettersTaskInput = {
  readonly extractorId: string;
  readonly eligible?: boolean;
};

export type ListDeadLettersTaskOutput = {
  /** Pending dead-letter rows; empty when only the eligible count was requested. */
  readonly pending: ExtractionDeadLetter[];
  /** Count eligible for retry under the active version; null unless `eligible` was set. */
  readonly eligibleCount: number | null;
};

/**
 * Lists an extractor's pending dead-letter entries, or (with `eligible`) counts
 * the entries eligible for retry under the active extractor version.
 */
export class ListDeadLettersTask extends Task<ListDeadLettersTaskInput, ListDeadLettersTaskOutput> {
  static readonly type = "ListDeadLettersTask";
  static readonly category = "SEC";
  static readonly title = "List dead letters";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      extractorId: Type.String({ title: "Extractor id", description: "e.g. 'S-1'" }),
      eligible: Type.Optional(Type.Boolean({ default: false })),
    });
  }

  public static outputSchema() {
    return Type.Object({
      pending: Type.Array(ExtractionDeadLetterSchema),
      eligibleCount: Type.Union([Type.Number(), Type.Null()]),
    });
  }

  async execute(input: ListDeadLettersTaskInput): Promise<ListDeadLettersTaskOutput> {
    if (input.eligible) {
      return { pending: [], eligibleCount: await countEligibleDeadLetters(input.extractorId) };
    }
    return {
      pending: await new ExtractionDeadLetterRepo().listPending(input.extractorId),
      eligibleCount: null,
    };
  }
}
