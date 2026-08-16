/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SPAC_REPOSITORY_TOKEN, type Spac } from "./SpacSchema";

describe("spac storage smoke", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("round-trips a spac row", async () => {
    const repo = globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN);
    const row: Spac = {
      cik: 1821595,
      current_cik: null,
      status: "ipo",
      spac_name: "10X Capital Venture Acquisition Corp",
      target_name: null,
      surviving_name: null,
      surviving_name_source: null,
      current_name: "10X Capital Venture Acquisition Corp",
      spac_sic: 6770,
      post_merger_sic: null,
      current_sic: 6770,
      spac_tickers: JSON.stringify(["VCVC.U", "VCVC", "VCVC.WS"]),
      post_merger_tickers: null,
      current_tickers: JSON.stringify(["VCVC.U", "VCVC", "VCVC.WS"]),
      ipo_proceeds: 201250000,
      trust_amount: 201250000,
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
      registration_date: "2020-12-21",
      ipo_date: "2021-01-15",
      unit_split_date: null,
      loi_date: null,
      definitive_agreement_date: null,
      proxy_date: null,
      vote_date: null,
      completed_date: null,
      failed_date: null,
      as_of: "2021-01-15",
      updated_at: new Date().toISOString(),
    };
    await repo.put(row);
    const got = await repo.get({ cik: 1821595 });
    expect(got?.spac_name).toBe("10X Capital Venture Acquisition Corp");
    expect(JSON.parse(got!.spac_tickers!)).toEqual(["VCVC.U", "VCVC", "VCVC.WS"]);
  });
});
