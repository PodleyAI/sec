/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { trimOfferingSectionText } from "./trimOfferingSection";

/**
 * Private-placement UNIT counts (e.g. 194,375) are not warrant counts. Models
 * often put them in `private_placement_warrants` when both appear. Strip the
 * leading count so the unit language remains (for "units only → warrants null")
 * without a competing number; the early "private placement warrants … 48,593"
 * table stays intact.
 */
const PRIVATE_PLACEMENT_UNIT_COUNT =
  /\b[\d,]+\s+(?=private placement units\b)/gi;

/** Offering trim, then drop private-placement unit counts that confuse warrants. */
export function trimSponsorPromoteSectionText(text: string): string {
  return trimOfferingSectionText(text).replace(PRIVATE_PLACEMENT_UNIT_COUNT, "");
}
