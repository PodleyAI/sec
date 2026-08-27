/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Spac } from "../../storage/spac/SpacSchema";

/**
 * A `spac` row with every optional column explicitly null.
 *
 * `TypeNullable` means "may hold null", not "may be absent": the storage layer
 * rejects a missing key on a nullable column, so a test row has to name all of
 * them. Written once here rather than per test file, because the failure mode
 * of a hand-rolled copy is a validation error on the day a column is added, in
 * whichever test happens to write a spac row.
 */
export function minimalSpac(cik: number, over: Partial<Spac> = {}): Spac {
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
    ...over,
  };
}
