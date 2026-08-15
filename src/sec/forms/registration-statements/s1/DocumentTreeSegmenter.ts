/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { NodeKind, renderMarkdown, traverseDepthFirst } from "workglow";
import type { DocumentNode, DocumentRootNode, SectionNode } from "workglow";
import {
  type DocumentSegmenter,
  S1_SECTIONS,
  type S1SectionName,
  type Section,
  SECTION_HEADING_PATTERNS,
} from "./DocumentSegmenter";

function matchTarget(title: string): S1SectionName | null {
  const line = title.replace(/\s+/g, " ").trim();
  for (const name of Object.keys(SECTION_HEADING_PATTERNS) as S1SectionName[]) {
    if (SECTION_HEADING_PATTERNS[name].some((re) => re.test(line))) return name;
  }
  return null;
}

/**
 * Targets a filing may nest as a plain bolded line inside a larger section
 * instead of giving them their own structural heading, with the section they
 * are nested in.
 *
 * Churchill Capital Corp XII is the case in point: its Item 402 disclosure
 * ("Officer and Director Compensation — None of our executive officers or
 * directors have received any cash compensation…") sits inside MANAGEMENT, so
 * the tree walk finds no SectionNode for it and the caller records
 * SECTION_NOT_FOUND — which is meant to flag a heading-pattern coverage hole,
 * and here fires on a filing whose heading the patterns already match. The
 * heading never reaches them because it is not a section in the tree.
 */
const NESTED_SECTION_FALLBACKS: ReadonlyArray<{
  readonly target: S1SectionName;
  readonly container: S1SectionName;
}> = [{ target: S1_SECTIONS.EXECUTIVE_COMPENSATION, container: S1_SECTIONS.MANAGEMENT }];

/**
 * Recovers `target` from the rendered body of `container` by scanning its lines
 * with the same heading patterns the tree walk uses. The slice runs from the
 * matched heading to the next line that is itself a known section heading (else
 * to the end of the container), which errs toward including trailing prose:
 * over-wide input costs nothing downstream — the compensation gate and the
 * source-span verifier both key off the text actually passed in — while a slice
 * cut short could drop the very table the extractor exists to read.
 */
export function findNestedSection(containerText: string, target: S1SectionName): string | null {
  const lines = containerText.split("\n");
  const start = lines.findIndex((line) => matchTarget(line) === target);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const name = matchTarget(lines[i] as string);
    if (name !== null && name !== target) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join("\n").trim();
  return body.length > 0 ? body : null;
}

/**
 * Containments a prospectus really has: a section that legitimately carries
 * another target's block inside it.
 *
 * The summary of a registration statement restates the offering table and the
 * sponsor block; the management section carries the Item 402 compensation
 * disclosure — the same pair {@link NESTED_SECTION_FALLBACKS} already encodes
 * from the other direction. Anything NOT listed here is a section that has
 * swallowed a sibling, which happens when the converter mis-levels a heading
 * (see {@link bodyUpToSwallowedSection}).
 *
 * Deliberately an explicit list rather than a threshold on how many sections got
 * swallowed. Both separate the observed cases, but a count answers "how badly
 * did this go wrong" when the question is "is this containment one prospectuses
 * actually have" — and that question has a small, checkable, domain answer.
 *
 * A summary's Item 105(b) "Summary of Risk Factors" list is deliberately NOT
 * here, even though a summary really does carry one. The segmenter accepts that
 * list as a Risk Factors heading variant, so on a filing whose whole body nests
 * under the summary heading the CHOSEN risk section sits inside the summary —
 * and allowing it let three committed fixtures keep summaries of 435k-452k that
 * contained the entire 250k risk section verbatim. Disallowing it brings those
 * to 176k-202k, in line with the 184k-217k summaries of filings that nest
 * nothing, and costs only the tail of a summary whose sole risk content is its
 * own 105(b) list — which still resolves as the Risk Factors section.
 */
const LEGITIMATE_CONTAINMENTS: ReadonlyArray<{
  readonly container: S1SectionName;
  readonly nested: S1SectionName;
}> = [
  { container: S1_SECTIONS.PROSPECTUS_SUMMARY, nested: S1_SECTIONS.THE_OFFERING },
  { container: S1_SECTIONS.PROSPECTUS_SUMMARY, nested: S1_SECTIONS.THE_SPONSOR },
  { container: S1_SECTIONS.MANAGEMENT, nested: S1_SECTIONS.EXECUTIVE_COMPENSATION },
];

function isLegitimateContainment(container: S1SectionName, nested: S1SectionName): boolean {
  return LEGITIMATE_CONTAINMENTS.some((c) => c.container === container && c.nested === nested);
}

function renderChildren(children: readonly DocumentNode[]): string {
  return children
    .map(renderMarkdown)
    .filter((s) => s.length > 0)
    .join("\n\n")
    .trim();
}

/**
 * True when `node` or anything beneath it is a chosen section that `container`
 * has no business carrying.
 */
function leadsToSwallowedSection(
  node: DocumentNode,
  container: S1SectionName,
  chosen: ReadonlyMap<DocumentNode, S1SectionName>
): boolean {
  for (const descendant of traverseDepthFirst(node)) {
    const nested = chosen.get(descendant);
    if (nested !== undefined && !isLegitimateContainment(container, nested)) return true;
  }
  return false;
}

/**
 * A section's body, stopping where it starts carrying another section's
 * canonical body.
 *
 * A converter that mis-levels a heading — `RISK FACTORS` in all caps at the top
 * level, every following sentence-case heading nested beneath it — makes that
 * section's subtree the rest of the prospectus. Bridgetown 3's Risk Factors
 * rendered to 586k chars that way, against its sibling filing's 161k, and blew
 * past `MAX_RISK_FACTORS_CHARS` so the disclosure was never extracted at all;
 * committed fixtures render "prospectus summaries" of 966k and 1,008k that are
 * the whole document.
 *
 * Two conditions narrow the stop, and both are load-bearing:
 *
 * - the nested node must be another target's CHOSEN body. A summary also
 *   contains a management paragraph and an offering blurb, but those lose to the
 *   filing's real Management and The Offering sections, so they are not chosen
 *   and stop nothing;
 * - the containment must not be one prospectuses really have
 *   ({@link LEGITIMATE_CONTAINMENTS}). Without this the summary of a filing
 *   whose only sponsor block sits inside it cuts at that block — 84k of summary
 *   down to 11k — and Management cuts at its own Item 402 disclosure.
 */
function bodyUpToSwallowedSection(
  section: SectionNode,
  container: S1SectionName,
  chosen: ReadonlyMap<DocumentNode, S1SectionName>
): string {
  const kept: DocumentNode[] = [];
  for (const child of section.children) {
    if (leadsToSwallowedSection(child, container, chosen)) break;
    kept.push(child);
  }
  return renderChildren(kept);
}

/**
 * Below this many resolved targets, the tree carries no usable structure and the
 * line scan takes over.
 *
 * Deliberately tiny. A line scan has no structural evidence — it matches heading
 * patterns against rendered text, so a table-of-contents entry looks exactly
 * like the heading it points at — and is therefore a last resort, not a
 * supplement. Across a 62-filing sample and the committed corpus, only one
 * filing (Bridgetown Holdings, whose 3.2 MB prospectus is typeset entirely
 * inside tables) falls below it, so the fallback cannot regress a filing that
 * currently works.
 */
const MIN_TREE_SECTIONS = 2;

/**
 * Segments the rendered document by scanning its lines with the same heading
 * patterns the tree walk uses, slicing each hit to the next one.
 *
 * This is {@link findNestedSection} widened from one container to the whole
 * document. It exists because a converter can produce a document with text but
 * no structure: an InDesign export typesets the prospectus inside hundreds of
 * tables, and Bridgetown Holdings' S-1 yields 4 heading nodes where a comparable
 * filing yields 70-140 — so every section is missing and the filing extracts
 * nothing at all, while 97% of its text sits right there in the tree.
 */
function segmentByLineScan(text: string): Section[] {
  const lines = text.split("\n");
  const hits: Array<{ name: S1SectionName; line: number }> = [];
  lines.forEach((line, index) => {
    // Rendered markdown carries heading and emphasis markers the patterns,
    // which are whole-line anchored, would not otherwise match through — and
    // the outer pipes of a one-cell table row, which is exactly the shape a
    // table-typeset prospectus renders its headings as. A genuine multi-column
    // row keeps its interior pipes and so still matches nothing.
    const name = matchTarget(line.replace(/^[#*|\s]+/, "").replace(/[*|\s]+$/, ""));
    if (name !== null) hits.push({ name, line: index });
  });

  const best = new Map<S1SectionName, Section>();
  hits.forEach((hit, i) => {
    const end = i + 1 < hits.length ? hits[i + 1]!.line : lines.length;
    const body = lines
      .slice(hit.line + 1, end)
      .join("\n")
      .trim();
    if (body.length === 0) return;
    const prev = best.get(hit.name);
    if (prev && prev.text.length >= body.length) return;
    best.set(hit.name, { name: hit.name, text: body, startOffset: 0, endOffset: 0 });
  });
  return [...best.values()];
}

/**
 * Walks a Document tree: for every SectionNode whose title matches a target S-1
 * heading, renders that section's subtree (minus the heading itself) to markdown.
 * When a heading appears more than once (e.g. a Table-of-Contents stub), keeps
 * the occurrence with the most body text — mirroring the prior HeuristicSegmenter.
 *
 * Then, in a second pass, truncates each chosen section where it has swallowed
 * another chosen section (see {@link bodyUpToSwallowedSection}). The two passes
 * are ordered that way because the truncation rule needs to know which
 * occurrence of each target won, which is only settled once the whole tree has
 * been walked.
 */
export interface SegmentationResult {
  readonly sections: readonly Section[];
  /**
   * The tree yielded almost nothing and {@link segmentByLineScan} was used.
   * Callers record it as a filing-level `CONVERTER_NO_STRUCTURE` dead-letter:
   * the sections may well have been recovered, but the converter still failed
   * on this filing and that is worth counting.
   */
  readonly usedLineScan: boolean;
}

export class DocumentTreeSegmenter implements DocumentSegmenter {
  segmentDocument(doc: DocumentRootNode): SegmentationResult {
    const best = new Map<S1SectionName, Section>();
    const bestNode = new Map<S1SectionName, SectionNode>();

    for (const node of traverseDepthFirst(doc)) {
      if (node.kind !== NodeKind.SECTION) continue;
      const section = node as SectionNode;
      const name = matchTarget(section.title);
      if (!name) continue;

      const body = renderChildren(section.children);
      // A matched heading with no body is effectively "not found" for extraction:
      // skip it so the caller records SECTION_NOT_FOUND (and does not waste an AI
      // call on an empty prompt) rather than emitting an empty section.
      if (body.length === 0) continue;
      const candidate: Section = {
        name,
        text: body,
        startOffset: section.range.startOffset,
        endOffset: section.range.endOffset,
      };
      const prev = best.get(name);
      if (!prev || candidate.text.length > prev.text.length) {
        best.set(name, candidate);
        bestNode.set(name, section);
      }
    }

    const chosen = new Map<DocumentNode, S1SectionName>();
    for (const [name, section] of bestNode) chosen.set(section, name);
    for (const [name, section] of bestNode) {
      const truncated = bodyUpToSwallowedSection(section, name, chosen);
      // Truncating to nothing would drop a section the walk did find, so the
      // untruncated body stands. That happens only when a section's very first
      // child leads to another section's canonical body, where today's
      // (over-wide) text is still better than none.
      if (truncated.length === 0) continue;
      best.set(name, { ...best.get(name)!, text: truncated });
    }

    // The tree carried no usable structure. Fall back to scanning the rendered
    // text, which is all a converter-defeating filing leaves to work with.
    const usedLineScan = best.size < MIN_TREE_SECTIONS;
    if (usedLineScan) {
      for (const section of segmentByLineScan(renderMarkdown(doc))) {
        const prev = best.get(section.name);
        if (!prev || section.text.length > prev.text.length) best.set(section.name, section);
      }
    }

    // Only after the tree walk: a real SectionNode always wins over a slice of
    // another section's body.
    for (const { target, container } of NESTED_SECTION_FALLBACKS) {
      if (best.has(target)) continue;
      const parent = best.get(container);
      if (!parent) continue;
      const text = findNestedSection(parent.text, target);
      if (text === null) continue;
      best.set(target, {
        name: target,
        text,
        startOffset: parent.startOffset,
        endOffset: parent.endOffset,
      });
    }

    return { sections: [...best.values()], usedLineScan };
  }

  segment(doc: DocumentRootNode): readonly Section[] {
    return this.segmentDocument(doc).sections;
  }
}
