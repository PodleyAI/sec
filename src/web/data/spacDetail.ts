/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type { Spac } from "../../storage/spac/SpacSchema";
import type { SpacDeal } from "../../storage/spac/SpacDealSchema";
import type { SpacEvent } from "../../storage/spac/SpacEventSchema";
import type { SpacHistory } from "../../storage/spac/SpacHistorySchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../../storage/spac/SpacCandidateSchema";
import type { SpacCandidate } from "../../storage/spac/SpacCandidateSchema";
import { SPAC_SPONSOR_LINK_REPOSITORY_TOKEN } from "../../storage/canonical/SpacSponsorLinkSchema";
import { UNDERWRITER_LINK_REPOSITORY_TOKEN } from "../../storage/canonical/UnderwriterLinkSchema";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";

/** A single field's value at one point in the SPAC row's history. */
export interface HistoryFieldChange {
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
}

/** One history snapshot, with the fields it changed relative to its predecessor. */
export interface HistorySnapshot {
  readonly row: SpacHistory;
  readonly changes: readonly HistoryFieldChange[];
}

/** Everything the SPAC detail page renders for one CIK. */
export interface SpacDetail {
  readonly cik: number;
  readonly entityName: string | null;
  readonly spac: Spac | undefined;
  readonly candidate: SpacCandidate | undefined;
  readonly deals: readonly SpacDeal[];
  readonly events: readonly SpacEvent[];
  readonly history: readonly HistorySnapshot[];
  readonly sponsorCount: number;
  readonly underwriterCount: number;
}

/**
 * Columns excluded from the per-snapshot diff. `cik` never changes and the
 * validity bounds change on every row by construction, so listing them would
 * bury the one or two fields a snapshot actually records.
 */
const HISTORY_BOOKKEEPING_FIELDS: ReadonlySet<string> = new Set([
  "cik",
  "valid_from",
  "valid_to",
  "change_source",
  "changed_at",
]);

/**
 * Diff consecutive history snapshots.
 *
 * The stored history is a sequence of full row snapshots, which answers "what
 * did the row say on date X" but not "what did this filing change" — and the
 * second question is the one an operator verifying a pipeline asks. The diff is
 * computed here rather than stored because it is a pure function of the rows,
 * and a stored diff would be one more thing a replay could leave stale.
 */
export function diffHistory(rows: readonly SpacHistory[]): readonly HistorySnapshot[] {
  const sorted = [...rows].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  return sorted.map((row, i) => {
    const prev = i === 0 ? undefined : sorted[i - 1];
    const changes: HistoryFieldChange[] = [];
    for (const [field, to] of Object.entries(row as Record<string, unknown>)) {
      if (HISTORY_BOOKKEEPING_FIELDS.has(field)) continue;
      const from = prev === undefined ? undefined : (prev as Record<string, unknown>)[field];
      // The first snapshot has no predecessor, so every non-null field it
      // carries is a change: it is what the registration statement established.
      if (prev === undefined) {
        if (to !== null && to !== undefined) changes.push({ field, from: null, to });
        continue;
      }
      if (!Object.is(from ?? null, to ?? null)) changes.push({ field, from: from ?? null, to });
    }
    return { row, changes };
  });
}

/** Load the consolidated SPAC picture for one CIK. */
export async function loadSpacDetail(cik: number): Promise<SpacDetail> {
  const repo = new SpacRepo();
  const candidateStorage = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
  const entityStorage = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
  const sponsorStorage = globalServiceRegistry.get(SPAC_SPONSOR_LINK_REPOSITORY_TOKEN);
  const underwriterStorage = globalServiceRegistry.get(UNDERWRITER_LINK_REPOSITORY_TOKEN);

  const [spac, deals, events, history, candidates, entities, sponsorRows, underwriterRows] =
    await Promise.all([
      repo.getSpac(cik),
      repo.getDeals(cik),
      repo.getEvents(cik),
      repo.getHistory(cik),
      candidateStorage.query({ cik }).then((r) => r ?? []),
      entityStorage.query({ cik }).then((r) => r ?? []),
      sponsorStorage.query({ issuer_cik: cik }).then((r) => r ?? []),
      underwriterStorage.query({ issuer_cik: cik }).then((r) => r ?? []),
    ]);

  return {
    cik,
    entityName: entities[0]?.name ?? null,
    spac,
    candidate: candidates[0],
    deals: [...deals].sort((a, b) => a.deal_index - b.deal_index),
    events: [...events].sort((a, b) =>
      a.event_date === b.event_date
        ? a.accession_number.localeCompare(b.accession_number)
        : a.event_date.localeCompare(b.event_date)
    ),
    history: diffHistory(history),
    sponsorCount: sponsorRows.length,
    underwriterCount: underwriterRows.length,
  };
}
