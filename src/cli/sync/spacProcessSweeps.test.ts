/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { MILESTONE_ITEM_CODES } from "../../sec/forms/miscellaneous-filings/Form_8_K.storage";
import { LOI_TRIGGER_ITEMS } from "../../sec/forms/miscellaneous-filings/spac8kLoiTriggers";
import { REDEMPTION_TRIGGER_ITEMS } from "../../sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
import { formsForExtractorIds } from "../../storage/versioning/extractorIds";
import {
  SPAC_PROCESS_EIGHT_K_ITEMS,
  SPAC_SHELF_424_FORMS,
  spacProcessSweeps,
} from "./spacProcessSweeps";

describe("spacProcessSweeps", () => {
  it("keeps eightKItems equal to the union of milestone, LOI, and redemption triggers", () => {
    expect(new Set(SPAC_PROCESS_EIGHT_K_ITEMS)).toEqual(
      new Set([...MILESTONE_ITEM_CODES, ...LOI_TRIGGER_ITEMS, ...REDEMPTION_TRIGGER_ITEMS])
    );
  });

  it("runs registration for every process CIK and lifecycle only for known SPACs", () => {
    const sweeps = spacProcessSweeps([1, 2], [1]);
    expect(sweeps).toHaveLength(2);

    expect(sweeps[0]!.ciks).toEqual([1, 2]);
    expect(sweeps[0]!.eightKItems).toBeUndefined();
    expect(sweeps[0]!.formTypes).toEqual(formsForExtractorIds(["S-1"]));

    expect(sweeps[1]!.ciks).toEqual([1]);
    expect(sweeps[1]!.eightKItems).toEqual(SPAC_PROCESS_EIGHT_K_ITEMS);
    expect(sweeps[1]!.formTypes).toContain("8-K");
    expect(sweeps[1]!.formTypes).toContain("424B4");
    expect(sweeps[1]!.formTypes).toContain("DEF 14A");
    expect(sweeps[1]!.formTypes).toContain("25-NSE");
    for (const form of SPAC_SHELF_424_FORMS) {
      expect(sweeps[1]!.formTypes).not.toContain(form);
    }
    for (const form of formsForExtractorIds(["S-1"])) {
      expect(sweeps[1]!.formTypes).not.toContain(form);
    }
  });

  it("omits the lifecycle sweep when no spac row exists yet", () => {
    const sweeps = spacProcessSweeps([2, 3], []);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]!.formTypes).toEqual(formsForExtractorIds(["S-1"]));
  });
});
