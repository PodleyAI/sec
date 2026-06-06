/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export function normalizeForSpanMatch(s: string | null | undefined): string {
  if (s == null) return "";
  return s
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function spanAppearsIn(haystack: string, span: string | null | undefined): boolean {
  const n = normalizeForSpanMatch(span);
  if (n.length < 3) return false;
  return normalizeForSpanMatch(haystack).includes(n);
}
