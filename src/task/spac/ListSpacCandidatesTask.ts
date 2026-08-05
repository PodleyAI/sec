/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, Task } from "workglow";
import {
  SPAC_CANDIDATE_CONFIDENCES,
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  type SpacCandidate,
  type SpacCandidateConfidence,
} from "../../storage/spac/SpacCandidateSchema";

export type ListSpacCandidatesTaskInput = {
  /** Keep only this confidence tier; omit for all three. */
  readonly confidence?: SpacCandidateConfidence;
  readonly limit?: number;
  readonly offset?: number;
};

export type ListSpacCandidatesTaskOutput = {
  readonly rows: SpacCandidate[];
  readonly total: number;
};

/** Reads `spac_candidate`, newest registration first. */
export class ListSpacCandidatesTask extends Task<
  ListSpacCandidatesTaskInput,
  ListSpacCandidatesTaskOutput
> {
  static readonly type = "ListSpacCandidatesTask";
  static readonly category = "SEC";
  static readonly title = "List SPAC candidates";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      confidence: Type.Optional(Type.Union(SPAC_CANDIDATE_CONFIDENCES.map((c) => Type.Literal(c)))),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    });
  }

  public static outputSchema() {
    return Type.Object({
      rows: Type.Array(Type.Unknown()),
      total: Type.Integer(),
    });
  }

  async execute(input: ListSpacCandidatesTaskInput): Promise<ListSpacCandidatesTaskOutput> {
    const repo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    const matched =
      input.confidence === undefined
        ? ((await repo.getAll()) ?? [])
        : ((await repo.query({ confidence: input.confidence })) ?? []);

    // Undated rows (no registration on file) sort last rather than leading the
    // list on an empty string.
    const sorted = [...matched].sort((a, b) =>
      (b.first_reg_date ?? "").localeCompare(a.first_reg_date ?? "")
    );
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 50;
    return { rows: sorted.slice(offset, offset + limit), total: sorted.length };
  }
}
