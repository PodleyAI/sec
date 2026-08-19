/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";

/**
 * Wipe this CIK's derived SPAC timeline so a full `spac process --force` can
 * replay filings against an empty event/deal stream. Does not mint a spac
 * row, and leaves editorial columns, current-trust facts, and spac_history.
 */
export async function resetSpacProcessState(cik: number): Promise<void> {
  const repo = new SpacRepo();
  const events = await repo.getEvents(cik);
  for (const e of events) {
    await repo.deleteEvent(cik, e.accession_number, e.event_type);
  }
  const deals = await repo.getDeals(cik);
  for (const d of deals) {
    await repo.deleteDeal(cik, d.deal_index);
  }
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  await runRepo.deleteForCik(cik);

  const existing = await repo.getSpac(cik);
  if (existing === undefined) return;
  await repo.saveSpac({
    ...existing,
    status: "registered",
    current_cik: null,
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
    pipe_amount: null,
    total_redemption_amount: null,
    focus: null,
    focus_location: null,
    description: null,
    target_description: null,
    team: null,
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
    updated_at: new Date().toISOString(),
  });
}
