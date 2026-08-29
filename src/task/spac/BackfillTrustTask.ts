/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { currentTrustRefresh } from "../../storage/spac/currentTrustRefresh";

export type BackfillTrustTaskInput = {
  readonly dryRun: boolean;
};

export type BackfillTrustTaskOutput = {
  readonly selected: number;
  readonly updated: number;
};

/**
 * Lifts the latest 10-Q/10-K AssetsHeldInTrust company-facts snapshot onto
 * every known SPAC's `current_trust_*` (idempotent; does not overwrite the
 * IPO `trust_amount`).
 */
export class BackfillTrustTask extends Task<BackfillTrustTaskInput, BackfillTrustTaskOutput> {
  static readonly type = "BackfillTrustTask";
  static readonly category = "SEC";
  static readonly title = "Backfill current trust";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      dryRun: Type.Boolean(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      selected: Type.Number(),
      updated: Type.Number(),
    });
  }

  async execute(input: BackfillTrustTaskInput): Promise<BackfillTrustTaskOutput> {
    // Which company fact is this SPAC's current trust balance is a reading a
    // consumer package contributes. With none contributed there is nothing to
    // select: enumerating every spac row to call nothing would report a
    // selection this deployment cannot act on. Said once per run rather than
    // once per SPAC — the answer is the same for all of them.
    const refresh = currentTrustRefresh();
    if (refresh === undefined) {
      console.warn(
        "backfill-trust: no current-trust refresh is registered, so no SPAC was selected. " +
          "The reading that lifts a 10-Q/10-K trust balance onto the spac row is supplied by " +
          "a consumer package."
      );
      return { selected: 0, updated: 0 };
    }
    const spacs = await new SpacRepo().getAllSpacs();
    let updated = 0;
    for (const s of spacs) {
      const changed = input.dryRun
        ? await refresh.wouldRefresh(s.cik)
        : await refresh.refresh(s.cik);
      if (changed) updated += 1;
    }
    return { selected: spacs.length, updated };
  }
}
