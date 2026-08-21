/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formsForExtractorIds } from "../../storage/versioning/extractorIds";

/**
 * 424 variants that are shelf takedowns / supplements, not a SPAC IPO
 * prospectus. `processForm424` returns after the deterministic XBRL pass for
 * these; they do not mint `ipo` events. Including them in `sync spacs` queued
 * every follow-on of a de-SPAC'd operating company.
 */
export const SPAC_SHELF_424_FORMS: ReadonlySet<string> = new Set([
  "424A",
  "424B2",
  "424B5",
  "424B7",
]);

/**
 * 8-K item codes that can carry SPAC lifecycle, LOI, or redemption content.
 * Kept equal (by test) to the union of `MILESTONE_ITEM_CODES`,
 * `LOI_TRIGGER_ITEMS`, and `REDEMPTION_TRIGGER_ITEMS`.
 */
export const SPAC_PROCESS_EIGHT_K_ITEMS: readonly string[] = [
  "1.01",
  "1.02",
  "2.01",
  "5.03",
  "5.07",
  "7.01",
  "8.01",
];

export interface SpacProcessSweep {
  readonly formTypes: string[];
  readonly ciks: number[];
  readonly eightKItems: readonly string[] | undefined;
}

/**
 * Split the SPAC process worklist so candidates without a `spac` row only
 * receive registration statements (which mint the row), and known SPACs skip
 * shelf 424s plus 8-Ks whose item codes cannot carry a lifecycle event.
 */
export function spacProcessSweeps(
  processCiks: readonly number[],
  knownCiks: readonly number[]
): SpacProcessSweep[] {
  const sweeps: SpacProcessSweep[] = [];
  if (processCiks.length > 0) {
    sweeps.push({
      formTypes: formsForExtractorIds(["S-1"]),
      ciks: [...processCiks],
      eightKItems: undefined,
    });
  }
  if (knownCiks.length > 0) {
    sweeps.push({
      formTypes: [
        ...formsForExtractorIds(["424"]).filter((form) => !SPAC_SHELF_424_FORMS.has(form)),
        ...formsForExtractorIds(["8-K", "merger-proxy", "25-15"]),
      ],
      ciks: [...knownCiks],
      eightKItems: SPAC_PROCESS_EIGHT_K_ITEMS,
    });
  }
  return sweeps;
}
