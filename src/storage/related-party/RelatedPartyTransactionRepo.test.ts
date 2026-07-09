/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { RelatedPartyTransactionRepo } from "./RelatedPartyTransactionRepo";

describe("RelatedPartyTransactionRepo", () => {
  let repo: RelatedPartyTransactionRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = new RelatedPartyTransactionRepo();
  });

  it("stores multiple transactions per filing and clears them", async () => {
    await repo.save({
      accession_number: "acc1",
      extractor_id: "S-1",
      transaction_index: 0,
      party_kind: "person",
      observation_id: 7,
      counterparty: "the Company",
      nature: "consulting agreement",
      amount: 250000,
      period: "2025",
      footnote: null,
    });
    await repo.save({
      accession_number: "acc1",
      extractor_id: "S-1",
      transaction_index: 1,
      party_kind: "company",
      observation_id: 8,
      counterparty: "the Company",
      nature: "registration rights",
      amount: null,
      period: null,
      footnote: "see note 4",
    });
    const rows = await repo.queryByAccession("acc1");
    expect(rows).toHaveLength(2);
    await repo.clear("acc1");
    expect(await repo.queryByAccession("acc1")).toHaveLength(0);
  });
});
