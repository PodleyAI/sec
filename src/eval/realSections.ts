/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEdgarHtml } from "../sec/html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "../sec/forms/registration-statements/s1/DocumentTreeSegmenter";
import { S1_SECTIONS } from "../sec/forms/registration-statements/s1/DocumentSegmenter";

/** Directory of committed real S-1 prospectus HTML (see its SOURCES.md). */
const S1_MOCK_DIR = "src/sec/html/mock_data/s1";

/**
 * Maps an eval extractor name to the S-1 segmenter section it reads, so the
 * oracle eval can pull real section prose for each. Only sections a document
 * actually contains (non-empty after segmentation) are yielded.
 */
const EXTRACTOR_TO_SECTION: Record<string, string> = {
  management: S1_SECTIONS.MANAGEMENT,
  "beneficial-ownership": S1_SECTIONS.BENEFICIAL_OWNERSHIP,
  "related-party": S1_SECTIONS.RELATED_PARTY,
  "offering-terms": S1_SECTIONS.THE_OFFERING,
};

export interface RealSection {
  /** Source filename (accession-derived). */
  readonly filing: string;
  /** Eval extractor name (key into EVAL_EXTRACTORS). */
  readonly extractor: string;
  readonly text: string;
}

/**
 * Segment every committed real S-1 HTML and yield the prose for each requested
 * extractor's section, skipping documents where that section is absent/empty.
 * A document that fails to parse is skipped (logged to the returned `skipped`).
 */
export function loadRealS1Sections(
  extractorNames: readonly string[],
  dir: string = S1_MOCK_DIR
): {
  readonly sections: RealSection[];
  readonly skipped: string[];
} {
  const files = readdirSync(dir).filter((f) => f.endsWith(".htm"));
  const sections: RealSection[] = [];
  const skipped: string[] = [];

  for (const file of files.sort()) {
    let byName: Map<string, string>;
    try {
      const html = readFileSync(join(dir, file), "utf8");
      const doc = parseEdgarHtml(html, file);
      const segmented = new DocumentTreeSegmenter().segment(doc);
      byName = new Map(segmented.map((s) => [s.name as string, s.text]));
    } catch (err) {
      skipped.push(`${file}: parse failed (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    for (const extractor of extractorNames) {
      const sectionName = EXTRACTOR_TO_SECTION[extractor];
      const text = sectionName ? byName.get(sectionName) : undefined;
      if (text && text.trim().length > 0) {
        sections.push({ filing: file.replace(/\.htm$/, ""), extractor, text });
      }
    }
  }
  return { sections, skipped };
}
