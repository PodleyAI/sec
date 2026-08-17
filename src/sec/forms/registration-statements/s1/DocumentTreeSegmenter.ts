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

function matchPatterns(line: string): S1SectionName | null {
  for (const name of Object.keys(SECTION_HEADING_PATTERNS) as S1SectionName[]) {
    if (SECTION_HEADING_PATTERNS[name].some((re) => re.test(line))) return name;
  }
  return null;
}

/**
 * A page number or footnote marker a converter fuses onto the end of a heading.
 *
 * `BurTech Acquisition Corp.` renders its ownership heading as
 * `PRINCIPAL STOCKHOLDERS3` — the anchor's superscript reference glued straight
 * on — and the whole table was lost to it. Bounded to three digits (page
 * numbers run to the hundreds) and only tried when the heading did not match as
 * printed, so it can never change what an unambiguous heading resolves to.
 */
const TRAILING_PAGE_MARKER = /\s*\d{1,3}$/;

function matchTarget(title: string): S1SectionName | null {
  const line = title.replace(/\s+/g, " ").trim();
  const direct = matchPatterns(line);
  if (direct !== null) return direct;
  const trimmed = line.replace(TRAILING_PAGE_MARKER, "");
  return trimmed === line ? null : matchPatterns(trimmed);
}

/**
 * A section a heading-shaped line inside cannot be trusted to introduce, because
 * the section's job is to restate the rest of the prospectus by name.
 *
 * A prospectus summary walks the whole document: it names the offering, the
 * sponsor, the management team and the risks, each as a bolded label. Read as a
 * nesting fallback (below) every one of those labels opens a slice running to
 * the next label, so the summary donates a section for a target the filing may
 * not disclose at all. That is not a hypothetical — it is the entire measured
 * cost of generalizing the fallback over the committed corpus: 6 wrong sections
 * in 42 fixtures, and **all 6** come out of a summary. A 208k "The Sponsor"
 * carved out of a 217k summary, a 136k "Management" for a filing whose roster is
 * documented as bolded paragraphs with no section at all.
 *
 * The summary's own offering table is the one real block inside it, and it stays
 * reachable through {@link NESTED_SECTION_FALLBACKS}.
 *
 * A slice-size guard was measured as the alternative and does not work. Five of
 * those six summary slices run 68-96% of their container — but the trusted
 * compensation-inside-management recovery runs 7-81% across 18 committed
 * fixtures, 14 of them above 68%. The two bands sit on top of each other, so a
 * threshold rejecting the summary slices deletes most of the recoveries that are
 * right, and the sixth summary slice is 14%, under everything. Which section is
 * donating separates them; how much of it does not.
 */
const RESTATING_CONTAINERS: readonly S1SectionName[] = [S1_SECTIONS.PROSPECTUS_SUMMARY];

/**
 * Targets a filing nests inside a {@link RESTATING_CONTAINERS} section as a
 * plain bolded line, on evidence that the block really is there.
 *
 * The general rule below cannot reach into a restating container, so a real
 * block inside one is named here. There is exactly one: the offering table,
 * which is what `LEGITIMATE_CONTAINMENTS` already expects a summary to carry,
 * and which `Mammon Omicron Acquisition Corp` bolds rather than heads — hiding
 * 90k characters of unit terms from the offering-terms extractor. It fires on 11
 * committed fixtures, at 13-59% of the summary.
 */
const NESTED_SECTION_FALLBACKS: ReadonlyArray<{
  readonly target: S1SectionName;
  readonly container: S1SectionName;
}> = [{ target: S1_SECTIONS.THE_OFFERING, container: S1_SECTIONS.PROSPECTUS_SUMMARY }];

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
  const body = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
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
 * Rendered characters a document must carry before its lack of structure counts
 * as a converter failure rather than as a small document.
 *
 * "The converter produced no structure" is only a claim you can make about a
 * document that had structure to produce. A short body with one heading is
 * answering correctly, and firing the fallback there would also record a
 * `CONVERTER_NO_STRUCTURE` dead-letter on a filing with nothing wrong with it.
 * Every real prospectus in the committed corpus renders well past this; the
 * filing that motivated the fallback renders 817k characters into 4 headings.
 */
const MIN_DOC_CHARS_FOR_LINE_SCAN = 50_000;

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
    // To the next hit of a DIFFERENT target, as `findNestedSection` does. A
    // typeset prospectus repeats its section name as a page header on every
    // page, so slicing to the next hit of ANY target chops the section into
    // one-page fragments — Bridgetown's risk factors came out as 5k of a 177k
    // section that way. A repeat of the same name is page furniture, not a
    // boundary.
    let end = lines.length;
    for (let j = i + 1; j < hits.length; j++) {
      if (hits[j]!.name !== hit.name) {
        end = hits[j]!.line;
        break;
      }
    }
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
    const rendered = best.size < MIN_TREE_SECTIONS ? renderMarkdown(doc) : "";
    const usedLineScan =
      best.size < MIN_TREE_SECTIONS && rendered.length >= MIN_DOC_CHARS_FOR_LINE_SCAN;
    if (usedLineScan) {
      for (const section of segmentByLineScan(rendered)) {
        const prev = best.get(section.name);
        if (!prev || section.text.length > prev.text.length) best.set(section.name, section);
      }
    }

    // Only after the tree walk: a real SectionNode always wins over a slice of
    // another section's body.
    for (const target of Object.keys(SECTION_HEADING_PATTERNS) as S1SectionName[]) {
      if (best.has(target)) continue;
      // Tightest enclosing body first. Section bodies overlap only where
      // `LEGITIMATE_CONTAINMENTS` says they may (a resolved Item 402 block sits
      // inside Management), and there the inner one bounds the slice to the
      // block that actually encloses the line rather than to whatever follows
      // its outer section.
      const containers = [...best.values()]
        .filter((s) => !RESTATING_CONTAINERS.includes(s.name))
        .sort((a, b) => a.text.length - b.text.length);
      // A pair declared against a restating container is evidence about that
      // container specifically, so it is consulted last: a real body section
      // donating the same target is the better claim.
      const declared = NESTED_SECTION_FALLBACKS.filter((f) => f.target === target)
        .map((f) => best.get(f.container))
        .filter((s): s is Section => s !== undefined);
      for (const parent of [...containers, ...declared]) {
        const text = findNestedSection(parent.text, target);
        if (text === null) continue;
        best.set(target, {
          name: target,
          text,
          startOffset: parent.startOffset,
          endOffset: parent.endOffset,
        });
        break;
      }
    }

    // Offering / underwriting / use-of-proceeds are often table-cell lines
    // rather than heading nodes (Pyrophyte II). When the tree already found
    // other targets, the converter-failure line scan never fires — scan
    // just these three against the full render so a working Risk Factors
    // heading does not hide the deal. Does not flip `usedLineScan`: that
    // flag is "the document had no structure", not "we supplemented one
    // section". Nested fallbacks run first so a real body-slice wins over
    // a table-of-contents line.
    const offeringLineScanTargets: readonly S1SectionName[] = [
      S1_SECTIONS.THE_OFFERING,
      S1_SECTIONS.UNDERWRITING,
      S1_SECTIONS.USE_OF_PROCEEDS,
    ];
    if (offeringLineScanTargets.some((t) => !best.has(t))) {
      for (const section of segmentByLineScan(renderMarkdown(doc))) {
        if (!offeringLineScanTargets.includes(section.name)) continue;
        const prev = best.get(section.name);
        if (!prev || section.text.length > prev.text.length) best.set(section.name, section);
      }
    }

    return { sections: [...best.values()], usedLineScan };
  }

  segment(doc: DocumentRootNode): readonly Section[] {
    return this.segmentDocument(doc).sections;
  }
}
