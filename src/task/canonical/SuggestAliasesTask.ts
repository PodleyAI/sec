/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, Task } from "workglow";
import {
  ENTITY_HISTORY_REPOSITORY_TOKEN,
  type EntityHistory,
} from "../../storage/entity/EntityHistorySchema";
import { EntityRepo } from "../../storage/entity/EntityRepo";
import type { TaskPorts } from "../taskPorts";
import {
  ALIAS_SUGGESTION_KINDS,
  type AliasSuggestion,
  type AliasSuggestionKind,
  type FilerName,
  suggestAliases,
} from "./suggestAliases";

export type SuggestAliasesTaskInput = {
  readonly kind: AliasSuggestionKind;
};

export interface SuggestAliasesTaskOutput {
  readonly suggestions: readonly AliasSuggestion[];
  /** Filers whose name history was examined. */
  readonly scanned: number;
}

/**
 * Suggests aliases for filers EDGAR has carried under two spellings.
 *
 * Reads the entity name history rather than the canonical tier, because the
 * evidence that two spellings are one entity is that EDGAR filed both under one
 * CIK — the canonical rows themselves are exactly what got split. See
 * {@link suggestAliases}.
 */
export class SuggestAliasesTask extends Task<
  SuggestAliasesTaskInput,
  TaskPorts<SuggestAliasesTaskOutput>
> {
  static readonly type = "SuggestAliasesTask";
  static readonly category = "SEC";
  static readonly title = "Suggest aliases";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      kind: Type.Union(ALIAS_SUGGESTION_KINDS.map((k) => Type.Literal(k))),
    });
  }

  public static outputSchema() {
    return Type.Object({
      suggestions: Type.Array(
        Type.Object({
          cik: Type.Number(),
          from: Type.String(),
          into: Type.String(),
          reason: Type.String(),
        })
      ),
      scanned: Type.Number(),
    });
  }

  async execute(input: SuggestAliasesTaskInput): Promise<TaskPorts<SuggestAliasesTaskOutput>> {
    const history = globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN);
    const rows: EntityHistory[] = (await history.getAll()) ?? [];

    // The CURRENT name comes from `entities`, not from a null `valid_to`: a
    // history row is a snapshot of a past state, and reading "the interval that
    // has not closed" as the current name would pick a stale row on any filer
    // whose history has not been re-snapshotted since its rename.
    const entities = await new EntityRepo().getAllEntities();
    const currentByCik = new Map<number, string>();
    for (const e of entities) if (e.name) currentByCik.set(e.cik, e.name);

    const names: FilerName[] = [];
    for (const [cik, name] of currentByCik) names.push({ cik, name, current: true });
    for (const row of rows) {
      if (!row.name) continue;
      if (!currentByCik.has(row.cik)) continue;
      names.push({ cik: row.cik, name: row.name, current: false });
    }

    return {
      suggestions: suggestAliases(input.kind, names),
      scanned: currentByCik.size,
    };
  }
}
