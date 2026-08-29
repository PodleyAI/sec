/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExtractorId } from "../../storage/versioning/extractorIds";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { allRegisteredExtractorIds, formsForExtractorIds } from "../../sec/forms/formExtractors";

/**
 * `expandFormTypes` reads the form-extractor registry during CLI argument
 * parsing, which can run before `bootstrapSecRuntime`. Without this call an
 * empty registry makes every extractor id look unrecognised, so a token like
 * `S-1` would pass through as a literal form code instead of expanding to
 * every form that extractor handles.
 *
 * `registerSecFormExtractors` registers once per registry generation, so this
 * neither duplicates the bootstrap's call nor overrides a downstream
 * package's registration under a shared key.
 */
registerSecFormExtractors();

/**
 * Re-exported rather than reimplemented. Callers here pass extractor ids, and
 * the registry is keyed `(id, section)` — matching an id against a key returns
 * nothing the moment an extractor registers under a section, so the two
 * lookups are not interchangeable and only one of them belongs to this name.
 *
 * It stays exported from this module because importing it from here is what
 * guarantees the registration above has already run.
 */
export { formsForExtractorIds };

/**
 * Turns CLI form tokens into the form codes a sweep should process.
 *
 * An extractor id (`D`) expands to every form that extractor handles (`D`,
 * `D/A`). A specific form code (`D/A`) is left alone. Tokens that are neither
 * stay as written so the worklist can warn on them.
 */
export function expandFormTypes(tokens: readonly string[]): string[] {
  const registered = new Set(allRegisteredExtractorIds());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const expanded = registered.has(token) ? formsForExtractorIds([token]) : [token];
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
  // 1-SA is absent because sec ships no extractor for it: a semiannual report
  // is nothing but its financial statements, and reading those is a scan of
  // human-authored tables a downstream package owns. A sweep that wants it
  // names the form (or that package's extractor id) directly.
  "reg-a": ["1-A", "1-K", "1-Z", "1-U", "QUALIF", "253G", "1-A-W"],
  "form-d": ["D"],
  // Both readings of a registration statement, a prospectus and a current
  // report: the structured one this package ships and the one a consumer may
  // add. An id nothing registered contributes no forms, so the same list serves
  // a package running alone and one running under a consumer that adds the
  // other half — and the ids whose whole reading is a consumer's
  // (`merger-proxy`, `25-15`) still have to be NAMED here, or a deployment that
  // supplies them would sweep those forms outside the timeline they belong to.
  spacs: ["S-1-xbrl", "S-1", "424-xbrl", "424", "8-K-items", "8-K", "merger-proxy", "25-15"],
} as const satisfies Record<string, readonly ExtractorId[]>;
