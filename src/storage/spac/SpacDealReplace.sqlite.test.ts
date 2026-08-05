/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import { getDb } from "../../util/db";
import { recomputeSpacDeals } from "./SpacDealReplace";
import type { SpacDeal } from "./SpacDealSchema";
import { SPAC_DEAL_REPOSITORY_TOKEN } from "./SpacDealSchema";

const TEST_DB_NAME = "spac_deal_replace_sqlite_test";

const deal = (cik: number, deal_index: number, overrides: Partial<SpacDeal> = {}): SpacDeal => ({
  cik,
  deal_index,
  target_name: null,
  target_cik: null,
  announced_date: null,
  definitive_agreement_date: null,
  proxy_date: null,
  vote_date: null,
  pipe_amount: null,
  redemption_amount: null,
  redemption_shares: null,
  outcome: "pending",
  outcome_date: null,
  source_accession: null,
  created_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

/**
 * Verifies that the SQLite transaction wrapping in `recomputeSpacDeals` rolls
 * back as a unit: an INSERT that violates the NOT NULL `outcome` constraint
 * fires inside the transaction (after the DELETE has run), and the wrapper
 * rolls everything back so the seeded rows are intact.
 */
describe("recomputeSpacDeals (sqlite) transactional rollback", () => {
  withSqliteDb(TEST_DB_NAME, [SPAC_DEAL_REPOSITORY_TOKEN]);

  it("rolls back the DELETE when a later INSERT fails inside the transaction", async () => {
    const dealRepo = globalServiceRegistry.get(SPAC_DEAL_REPOSITORY_TOKEN);
    // Seed: two deals (the "before" state we expect to survive the rollback).
    await dealRepo.put(deal(320193, 0, { outcome: "completed", source_accession: "seed-0" }));
    await dealRepo.put(deal(320193, 1, { outcome: "pending", source_accession: "seed-1" }));

    // Confirm the seed.
    const db = getDb();
    const before = db
      .prepare<
        [number],
        { deal_index: number; outcome: string; source_accession: string | null }
      >(`SELECT deal_index, outcome, source_accession FROM spac_deal WHERE cik = ? ORDER BY deal_index`)
      .all(320193);
    expect(before).toHaveLength(2);

    // Now attempt to delete deal_index=1 and re-upsert two rows where the
    // second has `outcome: null` (violates NOT NULL). The DELETE runs first,
    // then the first INSERT succeeds, then the second INSERT fails — the
    // wrapper rolls every step back.
    await expect(
      recomputeSpacDeals({
        dealRepo,
        cik: 320193,
        toDelete: [deal(320193, 1, { outcome: "pending", source_accession: "seed-1" })],
        toUpsert: [
          deal(320193, 0, {
            outcome: "completed",
            source_accession: "newer-0",
            redemption_amount: 1234,
          }),
          // @ts-expect-error — intentionally injecting a NOT NULL violation.
          deal(320193, 2, { outcome: null as unknown as "pending", source_accession: "newer-2" }),
        ],
      })
    ).rejects.toThrow();

    // After rollback the original two rows are still there, untouched.
    const after = db
      .prepare<
        [number],
        { deal_index: number; outcome: string; source_accession: string | null }
      >(`SELECT deal_index, outcome, source_accession FROM spac_deal WHERE cik = ? ORDER BY deal_index`)
      .all(320193);
    expect(after.map((r) => r.deal_index)).toEqual([0, 1]);
    expect(after[0].source_accession).toBe("seed-0");
    expect(after[1].source_accession).toBe("seed-1");
    // The deal that the rolled-back upsert would have mutated (deal_index 0
    // → redemption_amount=1234) is still at the seed.
    const seededRedemption = db
      .prepare<
        [number, number],
        { redemption_amount: number | null }
      >(`SELECT redemption_amount FROM spac_deal WHERE cik = ? AND deal_index = ?`)
      .get(320193, 0);
    expect(seededRedemption?.redemption_amount ?? null).toBeNull();
  });
});
