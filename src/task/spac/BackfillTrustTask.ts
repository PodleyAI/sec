/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import {
  refreshCurrentTrustFromFacts,
  wouldRefreshCurrentTrust,
} from "../../storage/spac/refreshCurrentTrust";

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
    const spacs = await new SpacRepo().getAllSpacs();
    let updated = 0;
    for (const s of spacs) {
      const changed = input.dryRun
        ? await wouldRefreshCurrentTrust(s.cik)
        : await refreshCurrentTrustFromFacts(s.cik);
      if (changed) updated += 1;
    }
    return { selected: spacs.length, updated };
  }
}
