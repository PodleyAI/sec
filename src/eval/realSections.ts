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
  underwriters: S1_SECTIONS.UNDERWRITING,
  "use-of-proceeds": S1_SECTIONS.USE_OF_PROCEEDS,
  "sponsor-promote": S1_SECTIONS.THE_OFFERING,
  "spac-profile": S1_SECTIONS.PROSPECTUS_SUMMARY,
  "spac-sponsors": S1_SECTIONS.THE_SPONSOR,
  // Only resolvable since the segmenter learned to rescue a compensation
  // heading nested inside MANAGEMENT — three of the four SPAC fixtures carry it
  // that way and previously yielded no section at all.
  "executive-compensation": S1_SECTIONS.EXECUTIVE_COMPENSATION,
  "spac-classification": S1_SECTIONS.PROSPECTUS_SUMMARY,
};

interface SegmentedFixture {
  /** Section name -> prose, or undefined when the fixture failed to parse. */
  readonly byName: Map<string, string> | undefined;
  readonly error: string | undefined;
}

/**
 * Parsed + segmented fixtures, keyed by absolute path. The corpus is committed
 * HTML that never changes under a running process, and a sweep asking for one
 * extractor at a time would otherwise re-segment tens of MB per call.
 */
const segmentedFixtures = new Map<string, SegmentedFixture>();

function segmentFixture(path: string, title: string): SegmentedFixture {
  const cached = segmentedFixtures.get(path);
  if (cached !== undefined) return cached;
  let result: SegmentedFixture;
  try {
    const html = readFileSync(path, "utf8");
    const doc = parseEdgarHtml(html, title);
    const segmented = new DocumentTreeSegmenter().segment(doc);
    result = {
      byName: new Map(segmented.map((s) => [s.name as string, s.text])),
      error: undefined,
    };
  } catch (err) {
    result = { byName: undefined, error: err instanceof Error ? err.message : String(err) };
  }
  segmentedFixtures.set(path, result);
  return result;
}

export interface RealSection {
  /** Source filename (accession-derived). */
  readonly filing: string;
  /** Eval extractor name (key into EVAL_EXTRACTORS). */
  readonly extractor: string;
  readonly text: string;
}

/**
 * The CIK a fixture filename encodes, or null when it is not of the
 * `<form>_<cik>_<accession>` shape the fetchers write.
 *
 * Leading zeros are stripped so `--cik 0001507957` and `--cik 1507957` select
 * the same filing — EDGAR itself uses both spellings, and a filter that
 * silently matched neither would look like "this CIK has no sections".
 */
export function fixtureCik(filing: string): string | null {
  const m = /^[A-Za-z0-9]+_(\d+)_/.exec(filing);
  return m?.[1] ? String(Number(m[1])) : null;
}

/**
 * The fixture HTML in the first directory that exists, with the directory that
 * won. Shared by the sweep and by the CLI's "which CIKs may I pass?" hint so the
 * two can never disagree about which corpus is in play under `--dir`.
 */
function listFixtureFiles(dir: string | undefined): {
  readonly resolvedDir: string;
  readonly files: string[];
} {
  const candidates = s1MockDirCandidates(dir);
  const resolvedDir = candidates.find(existsSync);
  const files = resolvedDir ? readdirSync(resolvedDir).filter((f) => f.endsWith(".htm")) : [];
  if (resolvedDir === undefined || files.length === 0) {
    throw new Error(`No S-1 fixtures found. Searched:\n  - ${candidates.join("\n  - ")}`);
  }
  return { resolvedDir, files };
}

/** Distinct filer CIKs the fixture corpus covers, ascending — what `--cik` accepts. */
export function availableFixtureCiks(dir?: string): string[] {
  const { files } = listFixtureFiles(dir);
  return [...new Set(files.map((f) => fixtureCik(f.replace(/\.htm$/, ""))))]
    .filter((c): c is string => c !== null)
    .sort((a, b) => Number(a) - Number(b));
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
  dir?: string,
  ciks?: readonly string[]
): {
  readonly sections: RealSection[];
  readonly skipped: string[];
} {
  const { resolvedDir, files: allFiles } = listFixtureFiles(dir);
  // A CIK filter that matches nothing is an error, not an empty sweep: the whole
  // point of `--cik` is isolating ONE filing, so "scored 0 sections" would read
  // as a passing run of a typo'd CIK.
  let files = allFiles;
  if (ciks && ciks.length > 0) {
    const wanted = new Set(ciks.map((c) => String(Number(c))));
    files = allFiles.filter((f) => {
      const cik = fixtureCik(f.replace(/\.htm$/, ""));
      return cik !== null && wanted.has(cik);
    });
    if (files.length === 0) {
      throw new Error(
        `No S-1 fixture matches CIK ${[...wanted].join(", ")} in ${resolvedDir}. ` +
          `Available CIKs: ${availableFixtureCiks(dir).join(", ")}`
      );
    }
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
  // Nothing to look for — don't pay to segment the corpus (tens of MB of HTML)
  // only to filter every section back out.
  if (mapped.length === 0) return { sections, skipped };

  for (const file of files.sort()) {
    const { byName, error } = segmentFixture(join(resolvedDir, file), file);
    if (byName === undefined) {
      skipped.push(`${file}: parse failed (${error})`);
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
