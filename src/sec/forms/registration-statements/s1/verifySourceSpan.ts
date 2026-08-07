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
 * Why a source_span failed verification. `too-long` and `not-found` are kept
 * apart on purpose: they have opposite causes and opposite fixes. A `too-long`
 * span is usually verbatim and correct — the model simply quoted more than the
 * cap allows — while `not-found` means the model produced text the section does
 * not contain (a paraphrase, or two real passages welded together across a gap).
 * Collapsing both into "not present in section text" makes the dead letter lie
 * about the first case and sends triage looking for a hallucination that isn't
 * there.
 */
export type SpanVerdict = "ok" | "too-long" | "not-found";

/**
 * Upper bound on a model-emitted source_span. A row whose span is bigger than
 * this is rejected even when it would otherwise verify — a "verbatim" span
 * spanning the whole section text is structurally indistinguishable from the
 * filer-controlled body and lets a prompt-injection attempt smuggle its entire
 * adversarial payload through the verifier.
 *
 * That rationale is about a span's size *relative to the section it cites*, so
 * the cap is computed per section by {@link spanCapFor} rather than being one
 * flat number. `MAX_SPAN_CHARS` is the absolute ceiling no span may exceed
 * regardless of section size; it is held at 2000 because `boundSourceSpan`
 * feeds `varchar(2000)` columns (`spac_loi_extraction`,
 * `spac_merger_extraction`, `spac_redemption_extraction`) — raising it past
 * that needs a schema migration first.
 *
 * `MAX_STORED_SPAN_CHARS` is the raw (pre-normalization) cap applied at write
 * time so an adversarial filer cannot park unbounded raw bytes on disk by
 * inflating a span with whitespace that collapses under normalization.
 */
export const MAX_SPAN_CHARS = 2000;
export const MAX_STORED_SPAN_CHARS = 2000;

/**
 * Floor on the per-section cap. The cap never drops below the historical flat
 * 1000, so no section becomes *stricter* than it was before the cap went
 * relative — this change can only admit spans that used to be rejected.
 */
export const MIN_SPAN_CAP_CHARS = 1000;

/** A span may not exceed this fraction of the section text it cites. */
export const MAX_SPAN_SECTION_FRACTION = 0.25;

/**
 * The span cap for one section: a quarter of the section, clamped to
 * [{@link MIN_SPAN_CAP_CHARS}, {@link MAX_SPAN_CHARS}]. A 28k-char Underwriting
 * section gets the full 2000; a 2k-char section keeps the old 1000.
 */
export function spanCapFor(text: string): number {
  const relative = Math.floor(text.length * MAX_SPAN_SECTION_FRACTION);
  return Math.min(MAX_SPAN_CHARS, Math.max(MIN_SPAN_CAP_CHARS, relative));
}

/**
 * Classifies a model-emitted span against the section text it claims to quote.
 * The raw (pre-normalization) length is checked first, so a span padded with
 * whitespace that would collapse under cap is still rejected as `too-long`.
 */
export function classifySpan(text: string, span: string | null | undefined): SpanVerdict {
  if (span == null) return "not-found";
  if (span.length > spanCapFor(text)) return "too-long";
  const n = normalizeForSpanMatch(span);
  if (n.length < 3) return "not-found";
  return normalizeForSpanMatch(text).includes(n) ? "ok" : "not-found";
}

/**
 * Combines the verdicts of several spans on one row (e.g. a risk factor's
 * headline and source_span) into the row's verdict. `ok` only when every part
 * is ok; `too-long` takes precedence over `not-found` so the dead letter names
 * the fixable cause when a row fails both ways.
 */
export function worstVerdict(...verdicts: readonly SpanVerdict[]): SpanVerdict {
  if (verdicts.includes("too-long")) return "too-long";
  if (verdicts.includes("not-found")) return "not-found";
  return "ok";
}

export function spanAppearsIn(haystack: string, span: string | null | undefined): boolean {
  return classifySpan(haystack, span) === "ok";
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
 * Row-verification entry point used by extractor `verifyRow` callbacks that
 * only need a boolean. Prefer {@link classifySpan} in the section runners: the
 * verdict is what lets a dead letter distinguish an over-cap span from a
 * hallucinated one.
 */
export function verifyRowSpan(text: string, span: string | null | undefined): boolean {
  return classifySpan(text, span) === "ok";
}
