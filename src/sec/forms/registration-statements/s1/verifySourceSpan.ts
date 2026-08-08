/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Collapses a run of markdown table pipes (and the whitespace around them) to a
 * single separator.
 *
 * The pipes are OUR artifact, not the filer's: the HTML→GFM converter emits
 * them, and a row boundary becomes `… |\n|  | …` — three pipes once newlines
 * collapse. A model quoting across two rows of the offering table reproduced
 * every word correctly but wrote `| |` where the render had `| | |`, and the
 * span was rejected as absent from a document it had copied faithfully. That
 * cost the whole offering-terms section — and with it the issuer's entire
 * ticker series — on every single run.
 *
 * Fuzzing only the separators keeps the check meaningful: the words, numbers
 * and their order must still match exactly, so an injected payload still cannot
 * manufacture a passing span. It just stops us demanding the model reproduce
 * our own table scaffolding character-for-character.
 */
function collapseTablePipes(s: string): string {
  return s.replace(/\s*\|(?:\s*\|)*\s*/g, " | ");
}

export function normalizeForSpanMatch(s: string | null | undefined): string {
  if (s == null) return "";
  return collapseTablePipes(
    s.normalize("NFKC").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ")
  )
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
 * An elision marker a model writes to skip material it does not want to quote
 * in full — literally "..." or "…" inside a span.
 */
const ELISION_MARKER = /(?:\.\.\.|…)/;

/**
 * Whether a model-emitted string skips material with an elision marker.
 *
 * Exported because the salvage {@link contiguousSpanHead} performs is a
 * *citation* concession, not a licence to store an abridged value: a field
 * whose contract is the filer's own words verbatim (a risk factor's caption)
 * must reject an elided value outright rather than persist its head as if it
 * were the whole thing.
 */
export function isElided(s: string | null | undefined): boolean {
  return s != null && ELISION_MARKER.test(s);
}

/**
 * Minimum length of the surviving head before an elided span is accepted, in
 * normalized characters. A model must have quoted something substantial for the
 * citation to be worth keeping; a few characters followed by "..." proves
 * nothing about document contact.
 */
const MIN_ELIDED_HEAD_CHARS = 40;

/**
 * The contiguous portion of a span, cut at the first elision marker.
 *
 * Some extractors return ONE `source_span` for an object with many fields — the
 * sponsor promote carries seven, scattered across a long table — and asking for
 * a single contiguous quote covering all of them is not satisfiable. Models
 * resolve that by stitching rows together with "..." separators, and they keep
 * doing it when told not to.
 *
 * Rejecting those outright cost the entire section on every run: seven correct
 * figures thrown away because the citation was over-ambitious. Keeping the head
 * keeps a citation that IS verbatim and DOES prove the model read the document,
 * which is what the span is for. The fabricated join is discarded rather than
 * stored, so what lands on disk is a real quote and not a construction.
 *
 * Verification and storage both go through here, so the span written to the
 * database is exactly the span that was checked.
 */
export function contiguousSpanHead(span: string): string {
  const cut = span.search(ELISION_MARKER);
  return cut === -1 ? span : span.slice(0, cut);
}

/**
 * `normalizeForSpanMatch` of the section text, memoized on the last text seen.
 *
 * Every row's verification re-normalizes the WHOLE section — risk factors do it
 * twice per row (headline and span) across ~90 rows of a section that runs to
 * a quarter of a megabyte, and the section runner repeats the pass up to
 * VERIFICATION_ATTEMPTS times. A one-entry memo collapses that to one pass per
 * section: the runner hands the same string instance to every call, so the
 * identity check is free. It is a cache, so a miss only costs the work that
 * would have happened anyway.
 */
let memoizedSectionText: string | undefined;
let memoizedSectionNormalized = "";
function normalizedSection(text: string): string {
  if (text !== memoizedSectionText) {
    memoizedSectionNormalized = normalizeForSpanMatch(text);
    memoizedSectionText = text;
  }
  return memoizedSectionNormalized;
}

/**
 * Classifies a model-emitted span against the section text it claims to quote.
 * The raw (pre-normalization) length of the contiguous head is checked first, so
 * a span padded with whitespace that would collapse under cap is still rejected
 * as `too-long`.
 */
export function classifySpan(text: string, span: string | null | undefined): SpanVerdict {
  if (span == null) return "not-found";
  const elided = ELISION_MARKER.test(span);
  const candidate = contiguousSpanHead(span);
  // The cap applies to the head, which is the only part that is verified and
  // the only part that is ever stored. Applying it to the raw span instead
  // would reject exactly the over-ambitious stitched citations the head exists
  // to salvage, since those are the long ones — and it would buy nothing: the
  // elided tail reaches neither the verifier nor the database.
  if (candidate.length > spanCapFor(text)) return "too-long";
  const n = normalizeForSpanMatch(candidate);
  // An elided span must leave a substantial verbatim head behind; an ordinary
  // span only has to clear the trivial-match floor.
  if (n.length < (elided ? MIN_ELIDED_HEAD_CHARS : 3)) return "not-found";
  return normalizedSection(text).includes(n) ? "ok" : "not-found";
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
  // Store the same contiguous head that was verified, never the elided
  // construction — a stored span has to be a quote you can find in the filing.
  const head = contiguousSpanHead(span);
  return head.length > MAX_STORED_SPAN_CHARS ? null : head;
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
