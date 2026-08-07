/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { NodeKind, renderMarkdown, traverseDepthFirst } from "workglow";
import type { DocumentRootNode, SectionNode } from "workglow";
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
 * Walks a Document tree: for every SectionNode whose title matches a target S-1
 * heading, renders that section's subtree (minus the heading itself) to markdown.
 * When a heading appears more than once (e.g. a Table-of-Contents stub), keeps
 * the occurrence with the most body text — mirroring the prior HeuristicSegmenter.
 */
export class DocumentTreeSegmenter implements DocumentSegmenter {
  segment(doc: DocumentRootNode): readonly Section[] {
    const best = new Map<S1SectionName, Section>();

    for (const node of traverseDepthFirst(doc)) {
      if (node.kind !== NodeKind.SECTION) continue;
      const section = node as SectionNode;
      const name = matchTarget(section.title);
      if (!name) continue;

      const body = section.children
        .map(renderMarkdown)
        .filter((s) => s.length > 0)
        .join("\n\n")
        .trim();
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
      if (!prev || candidate.text.length > prev.text.length) best.set(name, candidate);
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

    return [...best.values()];
  }
}
