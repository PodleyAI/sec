/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { NodeKind, renderMarkdown, traverseDepthFirst } from "workglow";
import type { DocumentRootNode, SectionNode } from "workglow";
import {
  type DocumentSegmenter,
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

    return [...best.values()];
  }
}
