/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { NodeKind, renderMarkdown } from "workglow";
import type { DocumentNode, DocumentRootNode, SectionNode } from "workglow";

/**
 * A filing's markdown, cut into flat, non-overlapping slices — one per heading.
 *
 * FLAT is the load-bearing word. `renderMarkdown` on a section node renders the
 * heading plus every descendant, so rendering each section independently would
 * store a long filing several times over: an S-1's "Risk Factors" would carry
 * every subsection beneath it, and each of those would be stored again on its
 * own. Slicing instead means each section holds its own heading and its own
 * direct content, and concatenating every slice in {@link FilingSectionSlice.ordinal}
 * order reproduces the document exactly.
 *
 * The nesting is not lost, it moves to `depth`: a section's full extent is
 * itself plus the run of following slices with a greater depth. That is the
 * range a reader means by "highlight Risk Factors", and it is one comparison at
 * read time rather than a second copy at rest.
 */
export interface FilingSectionSlice {
  /** Document order, 0-based. Slices concatenate back in this order. */
  readonly ordinal: number;
  /**
   * URL-safe identifier, unique within one filing. This is what the reader's
   * `?section=` names, so it is derived from the heading text rather than from
   * the ordinal — an ordinal shifts when the converter changes and would
   * silently retarget every link ever shared.
   */
  readonly slug: string;
  readonly title: string;
  /**
   * Heading level, 1-6. Zero for the preamble that precedes the first heading,
   * which has no heading of its own and encloses nothing.
   */
  readonly depth: number;
  readonly markdown: string;
}

/**
 * Cap on a slug's length. Long enough for the headings EDGAR filers actually
 * write, short enough to stay inside the storage column and a sane URL.
 */
const MAX_SLUG_LENGTH = 96;

/**
 * GitHub-style slug for a heading: lowercased, runs of anything that is not a
 * letter or digit collapsed to a single hyphen, trimmed.
 *
 * Unicode letters and digits are kept rather than stripped to ASCII. A filing
 * heading carrying an accent is not the same heading as one without it, and
 * folding them together is how two real sections end up fighting over one slug.
 */
function slugifyHeading(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    // The slice can land mid-run and leave a trailing hyphen.
    .replace(/-+$/g, "");
  return slug;
}

/**
 * Makes a slug unique within one filing by suffixing `-2`, `-3`, … on a repeat.
 *
 * Prospectuses repeat headings on purpose — "Overview" appears under the
 * business section and again under management's discussion — so collisions are
 * the normal case, not a malformed-filing case. First occurrence keeps the bare
 * slug so the common link stays short and stable.
 */
function uniqueSlug(base: string, ordinal: number, taken: Set<string>): string {
  const seed = base === "" ? `section-${ordinal}` : base;
  if (!taken.has(seed)) {
    taken.add(seed);
    return seed;
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${seed.slice(0, MAX_SLUG_LENGTH - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

const isSection = (node: DocumentNode): node is SectionNode => node.kind === NodeKind.SECTION;

/**
 * The markdown a node contributes on its own, excluding nested sections.
 *
 * Joined with a blank line and empty parts dropped, matching `renderMarkdown`'s
 * own join for a section body — which is what makes the concatenation of every
 * slice equal to `renderMarkdown(root)`.
 */
function renderOwnContent(children: readonly DocumentNode[]): string {
  return children
    .filter((child) => !isSection(child))
    .map(renderMarkdown)
    .filter((part) => part.length > 0)
    .join("\n\n");
}

/** The `#` run a section's heading is written with, clamped to markdown's range. */
const headingLevel = (level: number): number => Math.min(6, Math.max(1, level));

/**
 * Cut a parsed filing into {@link FilingSectionSlice}s in document order.
 *
 * Content sitting before the first heading becomes ordinal 0 at depth 0 — a
 * prospectus cover page is real content and dropping it would lose the offering
 * summary that sits above every heading in the document.
 */
export function splitDocumentSections(doc: DocumentRootNode): FilingSectionSlice[] {
  const slices: FilingSectionSlice[] = [];
  const taken = new Set<string>();

  const push = (title: string, depth: number, markdown: string): void => {
    const ordinal = slices.length;
    slices.push({
      ordinal,
      slug: uniqueSlug(slugifyHeading(title), ordinal, taken),
      title,
      depth,
      markdown,
    });
  };

  const preamble = renderOwnContent(doc.children);
  // Only when there is something there: an empty leading slice would be a row
  // that renders nothing and a slug nobody can link to meaningfully.
  if (preamble !== "") push(doc.title, 0, preamble);

  const walk = (node: SectionNode): void => {
    const level = headingLevel(node.level);
    const heading = `${"#".repeat(level)} ${node.title}`;
    const own = renderOwnContent(node.children);
    push(node.title, level, own === "" ? heading : `${heading}\n\n${own}`);
    for (const child of node.children) {
      if (isSection(child)) walk(child);
    }
  };

  for (const child of doc.children) {
    if (isSection(child)) walk(child);
  }

  return slices;
}

/**
 * The whole document, rebuilt from its slices.
 *
 * The read path's counterpart to the split, and the property the split is
 * tested against: no slice overlaps another, and together they are the filing.
 */
export const joinDocumentSections = (slices: readonly FilingSectionSlice[]): string =>
  [...slices]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((slice) => slice.markdown)
    .filter((markdown) => markdown.length > 0)
    .join("\n\n");
