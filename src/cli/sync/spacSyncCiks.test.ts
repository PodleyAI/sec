/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import {
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  type SpacCandidate,
} from "../../storage/spac/SpacCandidateSchema";
import { SPAC_REPOSITORY_TOKEN, type Spac } from "../../storage/spac/SpacSchema";
import { listKnownSpacCiks, listSpacProcessCiks } from "./spacSyncCiks";

function minimalSpac(cik: number): Spac {
  return {
    cik,
    current_cik: null,
    status: "registered",
    spac_name: null,
    target_name: null,
    surviving_name: null,
    surviving_name_source: null,
    current_name: null,
    spac_sic: null,
    post_merger_sic: null,
    current_sic: null,
    spac_tickers: null,
    post_merger_tickers: null,
    current_tickers: null,
    ipo_proceeds: null,
    trust_amount: null,
    current_trust_amount: null,
    current_trust_as_of: null,
    current_trust_filed: null,
    pipe_amount: null,
    total_redemption_amount: null,
    focus: null,
    focus_location: null,
    description: null,
    target_description: null,
    team: null,
    details: null,
    url_spac: null,
    url_sponsor: null,
    investorpres_url: null,
    investorpres_date: null,
    registration_date: null,
    ipo_date: null,
    unit_split_date: null,
    loi_date: null,
    definitive_agreement_date: null,
    proxy_date: null,
    vote_date: null,
    completed_date: null,
    failed_date: null,
    as_of: null,
    updated_at: "2026-08-17T00:00:00.000Z",
  };
}

function candidateRow(cik: number, confidence: SpacCandidate["confidence"]): SpacCandidate {
  return {
    cik,
    name: `Candidate ${cik}`,
    current_sic: 6770,
    signal_sic_6770: true,
    signal_filed_sic_6770: null,
    signal_name_match: true,
    signal_renamed_from: null,
    first_reg_form: "S-1",
    first_reg_date: "2024-01-15",
    reg_while_spac_named: true,
    confidence,
    identified_at: "2026-08-17T00:00:00.000Z",
  };
}

describe("listSpacProcessCiks", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("unions known spac rows with high and medium candidates, sorted and deduped", async () => {
    const spacRepo = globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN);
    const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);

    await spacRepo.put(minimalSpac(1));
    await candidateRepo.putBulk([
      candidateRow(1, "high"),
      candidateRow(2, "high"),
      candidateRow(3, "medium"),
      candidateRow(4, "low"),
    ]);

    await expect(listSpacProcessCiks()).resolves.toEqual([1, 2, 3]);
  });

  it("returns high and medium candidates when the spac table is empty", async () => {
    const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);

    await candidateRepo.putBulk([
      candidateRow(2, "high"),
      candidateRow(3, "medium"),
      candidateRow(4, "low"),
    ]);

    await expect(listSpacProcessCiks()).resolves.toEqual([2, 3]);
  });

  it("listKnownSpacCiks is the spac table only", async () => {
    const spacRepo = globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN);
    const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);

    await spacRepo.put(minimalSpac(1));
    await candidateRepo.putBulk([candidateRow(1, "high"), candidateRow(2, "high")]);

    await expect(listKnownSpacCiks()).resolves.toEqual([1]);
    await expect(listSpacProcessCiks()).resolves.toEqual([1, 2]);
  });
});
