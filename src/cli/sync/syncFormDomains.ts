/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExtractorId } from "../../storage/versioning/extractorIds";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { formsForExtractorKeys, listFormExtractorKeys } from "../../sec/forms/formExtractors";

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

/** Kept under its historical name: callers pass extractor ids, not registry keys. */
export function formsForExtractorIds(ids: readonly string[]): string[] {
  return formsForExtractorKeys(ids);
}

/**
 * Turns CLI form tokens into the form codes a sweep should process.
 *
 * An extractor id (`D`) expands to every form that extractor handles (`D`,
 * `D/A`). A specific form code (`D/A`) is left alone. Tokens that are neither
 * stay as written so the worklist can warn on them.
 */
export function expandFormTypes(tokens: readonly string[]): string[] {
  const registered = new Set(listFormExtractorKeys());
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
  "reg-a": ["1-A", "1-K", "1-Z", "1-SA", "1-U", "QUALIF", "253G", "1-A-W"],
  "form-d": ["D"],
  spacs: ["S-1", "424", "8-K", "merger-proxy", "25-15"],
} as const satisfies Record<string, readonly ExtractorId[]>;
