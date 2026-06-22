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

/**
 * Upper bound on a model-emitted source_span. A row whose span is bigger than
 * this is rejected even when it would otherwise verify — a "verbatim" span
 * spanning the whole section text is structurally indistinguishable from the
 * filer-controlled body and lets a prompt-injection attempt smuggle its entire
 * adversarial payload through the verifier. The cap is generous: real
 * sentence-level spans cited by the extractors fit comfortably under 1 KB.
 */
export const MAX_SPAN_CHARS = 1000;

export function spanAppearsIn(haystack: string, span: string | null | undefined): boolean {
  const n = normalizeForSpanMatch(span);
  if (n.length < 3) return false;
  if (n.length > MAX_SPAN_CHARS) return false;
  return normalizeForSpanMatch(haystack).includes(n);
}
