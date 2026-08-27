/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DocumentRootNode } from "workglow";
import { NodeKind, traverseDepthFirst } from "workglow";
import type { SectionNode } from "workglow";
import {
  S1_SECTIONS,
  SECTION_HEADING_PATTERNS,
  type S1SectionName,
} from "../sec/html/sectionVocabulary";
import type { SegmentationResult } from "../sec/forms/registration-statements/s1/DocumentTreeSegmenter";
import type { SourceSpan } from "../sec/html/types";
import { alphanumeric } from "./coverage";

/** Every canonical target, whether or not the filing resolved it. */
export interface SectionRecord {
  readonly name: S1SectionName;
  readonly resolved: boolean;
  readonly chars: number;
  /**
   * Half-open span of the filing HTML this section's body was rendered from, or
   * undefined when a text-level fallback recovered it and there is no mapping
   * back to the source. This is what a side-by-side view highlights.
   */
  readonly source: SourceSpan | undefined;
  /** First line of the section body, which is usually enough to recognize it. */
  readonly opening: string;
  /**
   * Other resolved sections wholly contained in this one's text. A prospectus
   * summary legitimately restates the offering; anything else here is a section
   * that swallowed a sibling.
   */
  readonly contains: readonly S1SectionName[];
}

export interface SectionTrace {
  readonly usedLineScan: boolean;
  readonly headingsInTree: number;
  /** Targets whose heading pattern matches a tree heading that produced no section. */
  readonly unresolvedWithHeading: readonly S1SectionName[];
  readonly sections: readonly SectionRecord[];
}

/**
 * Containments a prospectus really has. Anything outside this set means one
 * section's text swallowed another's, which is the shape of a mis-levelled
 * heading and is why a 208k "The Sponsor" can come out of a 217k summary.
 */
export const EXPECTED_CONTAINMENTS: ReadonlyArray<readonly [S1SectionName, S1SectionName]> = [
  [S1_SECTIONS.PROSPECTUS_SUMMARY, S1_SECTIONS.THE_OFFERING],
  [S1_SECTIONS.PROSPECTUS_SUMMARY, S1_SECTIONS.THE_SPONSOR],
  [S1_SECTIONS.PROSPECTUS_SUMMARY, S1_SECTIONS.RISK_FACTORS],
  [S1_SECTIONS.MANAGEMENT, S1_SECTIONS.EXECUTIVE_COMPENSATION],
  [S1_SECTIONS.UNDERWRITING, S1_SECTIONS.LOCK_UP],
];

/** Whether a containment is one the segmenter's own rules expect. */
export function isExpectedContainment(outer: S1SectionName, inner: S1SectionName): boolean {
  return EXPECTED_CONTAINMENTS.some(([a, b]) => a === outer && b === inner);
}

function matchesAnyTarget(title: string): S1SectionName | undefined {
  const line = title.replace(/\s+/g, " ").trim();
  for (const name of Object.keys(SECTION_HEADING_PATTERNS) as S1SectionName[]) {
    if (SECTION_HEADING_PATTERNS[name].some((re) => re.test(line))) return name;
  }
  return undefined;
}

/**
 * Account for what each target resolved to.
 *
 * Takes the segmentation the caller already ran rather than running its own:
 * the chunk stage needs the risk section's text, and segmenting a second time
 * to fetch it would mean the trace could describe a different segmentation than
 * the one it reports on.
 */
export function buildSectionTrace(
  doc: DocumentRootNode,
  segmentation: SegmentationResult
): SectionTrace {
  const { sections, usedLineScan } = segmentation;
  const byName = new Map(sections.map((s) => [s.name, s]));

  let headingsInTree = 0;
  const targetsWithHeading = new Set<S1SectionName>();
  for (const node of traverseDepthFirst(doc)) {
    if (node.kind !== NodeKind.SECTION) continue;
    headingsInTree++;
    const target = matchesAnyTarget((node as SectionNode).title);
    if (target !== undefined) targetsWithHeading.add(target);
  }

  // Containment is asked of the alphanumeric forms so the answer does not turn
  // on the markdown separators each side happens to carry.
  const normalized = new Map([...byName].map(([name, s]) => [name, alphanumeric(s.text)]));

  const records: SectionRecord[] = (Object.values(S1_SECTIONS) as S1SectionName[]).map((name) => {
    const section = byName.get(name);
    if (section === undefined) {
      return {
        name,
        resolved: false,
        chars: 0,
        source: undefined,
        opening: "",
        contains: [],
      };
    }
    const outer = normalized.get(name)!;
    const contains = [...normalized]
      .filter(([other, text]) => other !== name && text.length > 0 && outer.includes(text))
      .map(([other]) => other);
    return {
      name,
      resolved: true,
      chars: section.text.length,
      source: section.source,
      opening: (section.text.split("\n").find((l) => l.trim().length > 0) ?? "").slice(0, 160),
      contains,
    };
  });

  return {
    usedLineScan,
    headingsInTree,
    unresolvedWithHeading: [...targetsWithHeading].filter((t) => !byName.has(t)),
    sections: records,
  };
}
