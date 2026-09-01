/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SpacPromoteTermsRepo } from "./SpacPromoteTermsRepo";
import type { SpacPromoteTerms } from "./SpacPromoteTermsSchema";

function row(
  p: Partial<SpacPromoteTerms> & Pick<SpacPromoteTerms, "extractor_id" | "accession_number" | "cik">
): SpacPromoteTerms {
  return {
    founder_shares: null,
    founder_percent: null,
    private_placement_warrants: null,
    private_placement_warrant_price: null,
    public_warrant_coverage: null,
    trust_per_public_share: null,
    trust_total: null,
    confidence: 0.9,
    source_span: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

describe("SpacPromoteTermsRepo", () => {
  let repo: SpacPromoteTermsRepo;
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacPromoteTermsRepo();
  });

  it("round-trips a row and overwrites by (extractor_id, accession)", async () => {
    await repo.save(
      row({ extractor_id: "S-1", accession_number: "a1", cik: 5, founder_shares: 100 })
    );
    await repo.save(
      row({ extractor_id: "S-1", accession_number: "a1", cik: 5, founder_shares: 200 })
    );
    expect((await repo.get("S-1", "a1"))?.founder_shares).toBe(200);
  });

  it("keeps the S-1 registered and 424 final promote as distinct rows", async () => {
    await repo.save(
      row({ extractor_id: "S-1", accession_number: "a1", cik: 5, trust_per_public_share: 10.0 })
    );
    await repo.save(
      row({ extractor_id: "424", accession_number: "a2", cik: 5, trust_per_public_share: 10.2 })
    );
    const rows = await repo.listByCik(5);
    expect(rows.length).toBe(2);
    expect((await repo.get("S-1", "a1"))?.trust_per_public_share).toBe(10.0);
    expect((await repo.get("424", "a2"))?.trust_per_public_share).toBe(10.2);
  });

  it("returns [] for a CIK with no promote rows", async () => {
    expect(await repo.listByCik(99)).toEqual([]);
  });
});
