/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseEdgarHtml } from "../sec/html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "../sec/forms/registration-statements/s1/DocumentTreeSegmenter";
import { S1_SECTIONS } from "../sec/forms/registration-statements/s1/DocumentSegmenter";
import { fileURLToPath } from "node:url";
const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");

/**
 * Build the ordered list of S-1 mock-directory candidates:
 *   1. explicit `dir` argument (from `--dir` on `sec eval s1`);
 *   2. `SEC_S1_MOCK_DIR` env var;
 *   3. built-tree dist candidate (`importMetaDir` = `dist/eval/`);
 *   4. dev-tree source candidate (`importMetaDir` = `src/eval/`).
 *
 * `importMetaDir` points at `src/eval/` in dev and `dist/eval/` after
 * bundling, so (3) and (4) cover both layouts without depending on cwd.
 * The old code used a cwd literal ("src/sec/html/mock_data/s1"), which
 * broke the moment the binary ran from a different directory or was
 * bundled — this is Fix 2's whole point.
 */
function s1MockDirCandidates(dir: string | undefined): string[] {
  const candidates: string[] = [];
  if (dir !== undefined) candidates.push(dir);
  const envDir = process.env.SEC_S1_MOCK_DIR;
  if (envDir !== undefined && envDir !== "") candidates.push(envDir);
  candidates.push(join(importMetaDir, "../sec/html/mock_data/s1"));
  candidates.push(join(importMetaDir, "../../src/sec/html/mock_data/s1"));
  return candidates;
}

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
  "risk-factors": S1_SECTIONS.RISK_FACTORS,
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
 *
 * Resolution order for `dir`: an explicit argument wins, else the
 * `SEC_S1_MOCK_DIR` env var, else the built-tree dist copy, else the
 * dev-tree source. The last two are `importMetaDir`-relative so the
 * bundled `sec` binary can find its fixtures without depending on cwd.
 */
export function loadRealS1Sections(
  extractorNames: readonly string[],
  dir?: string
): {
  readonly sections: RealSection[];
  readonly skipped: string[];
} {
  const candidates = s1MockDirCandidates(dir);
  const resolvedDir = candidates.find(existsSync);
  const files = resolvedDir
    ? readdirSync(resolvedDir).filter((f) => f.endsWith(".htm"))
    : [];
  if (resolvedDir === undefined || files.length === 0) {
    throw new Error(
      `No S-1 fixtures found. Searched:\n  - ${candidates.join("\n  - ")}`
    );
  }
  const sections: RealSection[] = [];
  const skipped: string[] = [];

  // The CLI's --extractors validator accepts every EVAL_EXTRACTORS key, but only
  // some are backed by an S-1 section (`loi`, for one, reads 8-K narratives).
  // Report the unmappable ones as skipped — yielding nothing silently would make
  // "scored 0 sections" indistinguishable from a successful run.
  const mapped = extractorNames.filter((extractor) => {
    if (!Object.hasOwn(EXTRACTOR_TO_SECTION, extractor)) {
      skipped.push(`${extractor}: no S-1 section mapping — not scorable by the S-1 oracle`);
      return false;
    }
    return true;
  });

  for (const file of files.sort()) {
    let byName: Map<string, string>;
    try {
      const html = readFileSync(join(resolvedDir, file), "utf8");
      const doc = parseEdgarHtml(html, file);
      const segmented = new DocumentTreeSegmenter().segment(doc);
      byName = new Map(segmented.map((s) => [s.name as string, s.text]));
    } catch (err) {
      skipped.push(`${file}: parse failed (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    for (const extractor of mapped) {
      const sectionName = EXTRACTOR_TO_SECTION[extractor];
      const text = sectionName ? byName.get(sectionName) : undefined;
      if (text && text.trim().length > 0) {
        sections.push({ filing: file.replace(/\.htm$/, ""), extractor, text });
      }
    }
  }
  return { sections, skipped };
}
