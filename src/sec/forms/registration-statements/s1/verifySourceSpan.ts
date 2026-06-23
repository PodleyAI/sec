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
 *
 * `MAX_SPAN_CHARS` is the post-normalization cap used inside the verifier.
 * `MAX_STORED_SPAN_CHARS` is the raw (pre-normalization) cap applied at write
 * time so an adversarial filer cannot park unbounded raw bytes on disk by
 * inflating a span with whitespace that collapses under normalization.
 */
export const MAX_SPAN_CHARS = 1000;
export const MAX_STORED_SPAN_CHARS = 1000;

export function spanAppearsIn(haystack: string, span: string | null | undefined): boolean {
  const n = normalizeForSpanMatch(span);
  if (n.length < 3) return false;
  if (n.length > MAX_SPAN_CHARS) return false;
  return normalizeForSpanMatch(haystack).includes(n);
}

/**
 * Caps a model-emitted source_span at {@link MAX_STORED_SPAN_CHARS} raw chars.
 * Returns `null` for nullish input AND for over-cap spans — the verifier is
 * the appropriate gate for over-cap content; storing `null` here keeps the
 * column bounded without silently truncating a span that would later fail
 * span-verification anyway.
 */
export function boundSourceSpan(span: string | null | undefined): string | null {
  if (span == null) return null;
  return span.length > MAX_STORED_SPAN_CHARS ? null : span;
}

/**
 * Row-verification entry point used by extractor `verifyRow` callbacks.
 * Layered on top of {@link spanAppearsIn}: rejects any raw span exceeding
 * {@link MAX_STORED_SPAN_CHARS} BEFORE normalization, so a span that
 * whitespace-collapses under cap but ships megabytes of raw bytes is dropped.
 */
export function verifyRowSpan(text: string, span: string | null | undefined): boolean {
  if (span == null || span.length > MAX_STORED_SPAN_CHARS) return false;
  return spanAppearsIn(text, span);
}
