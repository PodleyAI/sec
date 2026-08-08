/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseFullName } from "@sroussey/parse-full-name";

export interface SplitName {
  readonly first: string | null;
  readonly middle: string | null;
  readonly last: string | null;
  /**
   * Both trailing parts as the filing wrote them — "Jr.", "CPA", or
   * "Jr., CPA". This lands in the observation's raw `suffix` column, which is
   * display rather than identity, so the credential belongs here; only
   * `normalized_suffix` (generational alone) reaches the resolver's match tuple.
   */
  readonly suffix: string | null;
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Splits "First [Middle] Last [Suffix]" from a prospectus name. Delegates to the
 * same `parseFullName` parser the entity layer uses (via `normalizePerson`), so
 * the raw observation fields agree with the normalized fields computed
 * downstream and comma-reversed "Last, First" forms are handled correctly.
 */
export function splitPersonName(full: string): SplitName {
  const parsed = parseFullName(full ?? "");
  return {
    first: blankToNull(parsed.first),
    middle: blankToNull(parsed.middle),
    last: blankToNull(parsed.last),
    suffix: blankToNull([parsed.generation, parsed.credential].filter(Boolean).join(", ")),
  };
}
