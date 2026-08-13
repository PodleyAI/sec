/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Characters of section prose handed to one structured-generation call. The
 * limit exists for the RESPONSE, not the prompt: a prospectus risk-factor
 * section enumerates 50–120 captions, and asking for all of them in one
 * response overruns the extractors' shared output-token ceiling, which
 * truncates the JSON and fails the whole section. Real sections run ~1.5–2.8k
 * chars per risk, so a chunk this size carries roughly 15–25 captions, and a
 * long section becomes a handful of independent, individually-bounded
 * enumerations. The chunk size alone was not enough: a live chunk returned 26
 * captions and truncated mid-object against the extractors' shared 4096-token
 * ceiling, so this section also generates under its own raised ceiling
 * (`RISK_FACTORS_MAX_TOKENS`). Both bounds matter — the chunk keeps the ask
 * enumerable, the ceiling keeps the answer expressible.
 */
export const RISK_FACTOR_CHUNK_CHARS = 40_000;

/**
 * Hard ceiling on the whole section. A risk-factor section this large is a
 * segmentation failure (the prospectus body collapsed under one heading), not a
 * real disclosure — the largest real section measured across the committed
 * fixtures is ~246k chars. Extracting it anyway would fan out into dozens of
 * model calls per filing, so the caller records `OVERSIZED_INPUT` instead.
 */
export const MAX_RISK_FACTORS_CHARS = 400_000;

/** Upper bound on a category heading's length; real ones run well under it. */
const CATEGORY_MAX_CHARS = 200;

/**
 * A dotted initialism closing the line ("…Operations in the U.S.", "…by the
 * S.E.C."). Its final period is part of the abbreviation, not sentence
 * punctuation, so a heading ending this way must not be read as a caption.
 */
const TRAILING_INITIALISM = /(?:\b[A-Za-z]\.){2,}$/;

export function stripHeadingMarkers(paragraph: string): string {
  return paragraph.replace(/^#{1,6}\s*/, "").trim();
}

/**
 * A category heading inside the risk-factor section ("Risks Relating to our
 * Securities", "General Risk Factors", "RISKS RELATED TO GOLD"). Detected
 * structurally rather than by matching a fixed vocabulary: short, mentions
 * risk, and — unlike a risk caption, which is a full sentence — does not end in
 * sentence punctuation.
 *
 * Two callers: {@link chunkRiskFactorText} carries the last heading into the
 * next chunk, where a false positive costs only a redundant context line; and
 * the extractor uses it to ask whether a response's rows are homogeneous in
 * shape — a verdict that both fails a mixed section and decides whether a
 * carried-heading echo is dropped, so a miss here costs real rows.
 */
export function isRiskCategoryHeading(paragraph: string): boolean {
  const line = stripHeadingMarkers(paragraph);
  if (line.length === 0 || line.length > CATEGORY_MAX_CHARS) return false;
  if (line.includes("\n")) return false;
  if (/[.?!;:]$/.test(line) && !TRAILING_INITIALISM.test(line)) return false;
  return /\brisks?\b/i.test(line);
}

export interface RiskFactorChunk {
  /** Prose handed to one structured-generation call, carried prefix included. */
  readonly text: string;
  /**
   * The category-heading line prepended to this chunk, or null when the chunk
   * opens on its own heading (or is the first). A row echoing it back is an
   * artifact of the prefix, not a caption the filer printed.
   */
  readonly carriedHeading: string | null;
}

/**
 * Splits risk-factor section prose into chunks of at most `maxChars`, never
 * cutting a paragraph. Each chunk after the first is prefixed with the most
 * recent category heading seen before it, so a chunk that starts mid-category
 * can still attribute its captions. That prefix is a verbatim line from the
 * section, so a caption or span quoting it still verifies against the full
 * section text — and it is reported back on the chunk (`carriedHeading`) so the
 * extractor can drop a row echoing it by exact match, which is the one drop
 * that provably discards nothing the filer wrote.
 *
 * A single paragraph longer than `maxChars` becomes its own oversized chunk:
 * splitting inside it would hand the model half a caption and produce a row
 * that cannot verify.
 */
export function chunkRiskFactorText(
  text: string,
  maxChars: number = RISK_FACTOR_CHUNK_CHARS
): RiskFactorChunk[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) return [];

  const chunks: RiskFactorChunk[] = [];
  let current: string[] = [];
  let currentChars = 0;
  let carriedCategory: string | null = null;
  let lastCategory: string | null = null;

  const flush = (): void => {
    if (current.length === 0) return;
    // A chunk that already opens on a category heading needs no carried one.
    const carried =
      carriedCategory !== null && !isRiskCategoryHeading(current[0]) ? carriedCategory : null;
    chunks.push({
      text: (carried !== null ? [carried, ...current] : current).join("\n\n"),
      carriedHeading: carried,
    });
    carriedCategory = lastCategory;
    current = [];
    currentChars = 0;
  };

  for (const paragraph of paragraphs) {
    if (currentChars > 0 && currentChars + paragraph.length > maxChars) flush();
    current.push(paragraph);
    currentChars += paragraph.length + 2;
    if (isRiskCategoryHeading(paragraph)) lastCategory = paragraph;
  }
  flush();
  return chunks;
}
