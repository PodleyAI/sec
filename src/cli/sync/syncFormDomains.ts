/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExtractorId } from "../../storage/versioning/extractorIds";
import { EXTRACTOR_IDS, formsForExtractorIds } from "../../storage/versioning/extractorIds";

export { formsForExtractorIds };

const EXTRACTOR_ID_SET: ReadonlySet<string> = new Set(EXTRACTOR_IDS);

/**
 * Turns CLI form tokens into the form codes a sweep should process.
 *
 * An extractor id (`D`) expands to every form that extractor handles (`D`,
 * `D/A`). A specific form code (`D/A`) is left alone. Tokens that are neither
 * stay as written so the worklist can warn on them.
 */
export function expandFormTypes(tokens: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const expanded = EXTRACTOR_ID_SET.has(token)
      ? formsForExtractorIds([token as ExtractorId])
      : [token];
    for (const form of expanded) {
      if (seen.has(form)) continue;
      seen.add(form);
      out.push(form);
    }
  }
  return out;
}

export const SYNC_FORM_DOMAINS = {
  portals: ["CFPORTAL"],
  crowdfunding: ["C"],
  "reg-a": ["1-A", "1-K", "1-Z", "1-SA", "1-U", "QUALIF", "253G", "1-A-W"],
  "form-d": ["D"],
  spacs: ["S-1", "424", "8-K", "merger-proxy", "25-15"],
} as const satisfies Record<string, readonly ExtractorId[]>;
