/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PrimaryDocLike {
  readonly primary_doc: string | null | undefined;
}

/**
 * Resolves the prospectus document filename to fetch for an S-1. EDGAR stores
 * it in `filing.primary_doc`; some rows carry an `xsl.../` viewer prefix that
 * must be stripped to reach the raw HTML. Returns null when unresolved
 * (callers dead-letter as PRIMARY_DOC_UNRESOLVED).
 */
export function resolveS1PrimaryDoc(filing: PrimaryDocLike): string | null {
  const raw = (filing.primary_doc ?? "").trim();
  if (raw === "") return null;
  return raw.replace(/^xsl[^/]+\//, "");
}
