/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SectionNode, TableNode } from "workglow";
import { NodeKind, traverseDepthFirst } from "workglow";
import type { S1SectionName } from "./sectionVocabulary";
import { S1_SECTIONS } from "./sectionVocabulary";
import { DocumentTreeSegmenter } from "../forms/registration-statements/s1/DocumentTreeSegmenter";
import { parseEdgarHtml } from "./parseEdgarHtml";
import { fileURLToPath } from "node:url";
const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");

const {
  MANAGEMENT,
  BENEFICIAL_OWNERSHIP,
  RELATED_PARTY,
  THE_OFFERING,
  UNDERWRITING,
  USE_OF_PROCEEDS,
  THE_SPONSOR,
  PROSPECTUS_SUMMARY,
  EXECUTIVE_COMPENSATION,
  RISK_FACTORS,
  LOCK_UP,
} = S1_SECTIONS;
const dir = join(importMetaDir, "mock_data", "s1");

/**
 * Real-filing corpus (see SOURCES.md). The expected target sections pin the
 * converter + segmenter behavior against real markup; update intentionally when
 * heading detection or the section patterns change.
 */
const EXPECTED: Record<string, readonly S1SectionName[]> = {
  // Section lists are GENERATED from actual segmentation, not hand-written, so
  // they record what the segmenter does rather than what it ought to do.
  // Known defects deliberately pinned here so a fix shows up as an intentional
  // diff:
  //   2135163 Albatross, 2137679 OceanLight — RISK_FACTORS collapses to a ~1k
  //     stub because the agent emits the risk sub-headings as SIBLING sections,
  //     leaving the parent with only its preamble. Both are agent 0001829126.
  //   2136360 Material Resource — no MANAGEMENT section at all, so this filing
  //     extracts ZERO people. The roster is a plain bolded paragraph inside
  //     'Proposed Business', styled like body text.
  "s1_1083743_000149315226025047.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    RELATED_PARTY,
  ],
  "s1_1489993_000162828026025811.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    RELATED_PARTY,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
    LOCK_UP,
  ],
  "s1_1507957_000143774926010088.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    RELATED_PARTY,
    EXECUTIVE_COMPENSATION,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
  ],
  "s1_1554818_000168316826002663.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    UNDERWRITING,
    LOCK_UP,
  ],
  "s1_1563568_000143774926013504.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    UNDERWRITING,
  ],
  "s1_1602409_000152013826000232.htm": [
    PROSPECTUS_SUMMARY,
    // Gained when the CSS `font` shorthand became readable: this filing marks
    // its headings with `font: bold 10pt ...` rather than `font-weight`, so the
    // section was invisible before. Verified as a real "The Offering" summary
    // table (shares offered, shares outstanding, Nasdaq symbol FNGR).
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    UNDERWRITING,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
  ],
  "s1_1606242_000121390026054471.htm": [
    PROSPECTUS_SUMMARY,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    RELATED_PARTY,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
    LOCK_UP,
  ],
  "s1_1816017_000119312526173846.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    UNDERWRITING,
  ],
  "s1_1817004_000149315226027137.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    UNDERWRITING,
  ],
  "s1_1822912_000121390021001475.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
  ],
  "s1_1848507_000119312521066104.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    RELATED_PARTY,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
  ],
  "s1_1849380_000149315226031598.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    RELATED_PARTY,
    UNDERWRITING,
  ],
  "s1_1849470_000110465921035696.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
    LOCK_UP,
  ],
  "s1_1853138_000162828026039200.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    UNDERWRITING,
  ],
  "s1_1880613_000162828026005423.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    RELATED_PARTY,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
  ],
  "s1_1918102_000110465926016226.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    RELATED_PARTY,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
    LOCK_UP,
  ],
  "s1_1925283_000162828026027260.htm": [
    PROSPECTUS_SUMMARY,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    RELATED_PARTY,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
    LOCK_UP,
  ],
  "s1_2030954_000149315226027129.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
    LOCK_UP,
  ],
  "s1_2049662_000110465926079324.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    RELATED_PARTY,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
  ],
  "s1_2075109_000121390026073335.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    RELATED_PARTY,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
    LOCK_UP,
  ],
  "s1_2087989_000143774926019444.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    UNDERWRITING,
    THE_SPONSOR,
  ],
  "s1_2091349_000119312526214778.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    LOCK_UP,
  ],
  "s1_2093507_000182912626003406.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    RELATED_PARTY,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
    LOCK_UP,
  ],
  "s1_2098410_000110465926086682.htm": [
    PROSPECTUS_SUMMARY,
    THE_SPONSOR,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
    LOCK_UP,
  ],
  "s1_2105318_000149315226031978.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
  ],
  "s1_2110105_000162828026032836.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    RELATED_PARTY,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
    LOCK_UP,
  ],
  "s1_2110119_000121390026072712.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
    LOCK_UP,
  ],
  "s1_2113481_000121390026068811.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
    LOCK_UP,
  ],
  "s1_2114227_000121390026039320.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
  ],
  "s1_2114229_000121390026078277.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
  ],
  "s1_2116230_000192998026000257.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
    LOCK_UP,
  ],
  "s1_2123955_000121390026080433.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
  ],
  "s1_2128045_000121390026070217.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
    LOCK_UP,
  ],
  "s1_2131350_000119312526294964.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
    LOCK_UP,
  ],
  "s1_2133239_000192998026000317.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
    LOCK_UP,
  ],
  "s1_2134856_000182912626007847.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    LOCK_UP,
  ],
  "s1_2135163_000182912626006553.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
    LOCK_UP,
  ],
  "s1_2136360_000213636026000003.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    LOCK_UP,
  ],
  "s1_2137679_000182912626006500.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
    LOCK_UP,
  ],
  "s1_2137965_000119312526308950.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
  ],
  "s1_2147219_000110465926092088.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    UNDERWRITING,
    EXECUTIVE_COMPENSATION,
  ],
  "s1_95572_000121390026086369.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    RISK_FACTORS,
    USE_OF_PROCEEDS,
    MANAGEMENT,
    EXECUTIVE_COMPENSATION,
    RELATED_PARTY,
    BENEFICIAL_OWNERSHIP,
    UNDERWRITING,
    LOCK_UP,
  ],
};

const SPAC_FIXTURES = [
  "s1_1848507_000119312521066104.htm",
  "s1_1849470_000110465921035696.htm",
  "s1_1822912_000121390021001475.htm",
  "s1_2114227_000121390026039320.htm",
  "s1_2147219_000110465926092088.htm",
];

/**
 * Minimum body size, in characters, of each resolved section. Section
 * *presence* alone is not enough: a section whose body is cut short at the
 * first page break still resolves, so a presence-only corpus stayed green while
 * every section of a 12 MB prospectus had been truncated to a few thousand
 * characters.
 *
 * Each floor is roughly half the size the section actually resolves to, so a
 * routine parser adjustment has room to move a section a little without
 * failing, while any halving of a section's body — the signature of silent
 * truncation — is caught. Re-derive the same way (observed / 2, rounded down)
 * when a deliberate change moves these.
 *
 * Five PROSPECTUS_SUMMARY floors were lowered when the segmenter learned to stop
 * a section where it has swallowed another section's canonical body. They were
 * recording the defect: these filings nest their whole prospectus under the
 * summary heading, so the summary rendered to 966k and 1,008k characters — the
 * entire document, risk factors and all — and the floor pinned it there. They
 * now resolve to 176k-202k, in line with the 184k-217k summaries of filings that
 * nest nothing. A floor is a truncation alarm, so it can only be lowered
 * alongside evidence that the shrink is the section getting more accurate.
 *
 * A section with no entry here is not size-checked, so adding a section to
 * {@link EXPECTED} does not require adding a floor.
 */
const MIN_SECTION_CHARS: Readonly<Record<string, Partial<Record<S1SectionName, number>>>> = {
  // Floors are observed/2, generated alongside EXPECTED. A section under 2k
  // carries no floor: halving a stub is not a signal, and two fixtures ARE
  // stubs (see the RISK_FACTORS note above).
  "s1_1083743_000149315226025047.htm": {
    [PROSPECTUS_SUMMARY]: 35_400,
    [THE_OFFERING]: 2_800,
    [RISK_FACTORS]: 43_200,
    [USE_OF_PROCEEDS]: 1_000,
    [MANAGEMENT]: 14_700,
    [EXECUTIVE_COMPENSATION]: 12_500,
    [RELATED_PARTY]: 5_100,
  },
  "s1_1489993_000162828026025811.htm": {
    [PROSPECTUS_SUMMARY]: 78_300,
    [THE_OFFERING]: 4_100,
    [RISK_FACTORS]: 148_200,
    [USE_OF_PROCEEDS]: 1_600,
    [MANAGEMENT]: 15_400,
    [EXECUTIVE_COMPENSATION]: 53_000,
    [RELATED_PARTY]: 12_900,
    [BENEFICIAL_OWNERSHIP]: 13_800,
    [UNDERWRITING]: 16_800,
    [LOCK_UP]: 12_400,
  },
  "s1_1507957_000143774926010088.htm": {
    [PROSPECTUS_SUMMARY]: 6_800,
    [RISK_FACTORS]: 6_200,
    [MANAGEMENT]: 5_900,
    [EXECUTIVE_COMPENSATION]: 9_200,
    [BENEFICIAL_OWNERSHIP]: 3_900,
    [UNDERWRITING]: 2_700,
  },
  "s1_1554818_000168316826002663.htm": {
    [PROSPECTUS_SUMMARY]: 11_500,
    [THE_OFFERING]: 3_900,
    [RISK_FACTORS]: 10_400,
    [USE_OF_PROCEEDS]: 1_900,
    [UNDERWRITING]: 5_100,
    [LOCK_UP]: 2_200,
  },
  "s1_1563568_000143774926013504.htm": {
    [PROSPECTUS_SUMMARY]: 24_300,
    [THE_OFFERING]: 1_900,
    [RISK_FACTORS]: 4_100,
    [UNDERWRITING]: 4_100,
  },
  "s1_1602409_000152013826000232.htm": {
    [PROSPECTUS_SUMMARY]: 33_900,
    [RISK_FACTORS]: 50_900,
    [UNDERWRITING]: 2_800,
    [MANAGEMENT]: 19_200,
    [EXECUTIVE_COMPENSATION]: 5_300,
    [BENEFICIAL_OWNERSHIP]: 4_000,
  },
  "s1_1606242_000121390026054471.htm": {
    [PROSPECTUS_SUMMARY]: 24_400,
    [RISK_FACTORS]: 57_700,
    [MANAGEMENT]: 11_200,
    [EXECUTIVE_COMPENSATION]: 19_100,
    [RELATED_PARTY]: 4_300,
    [BENEFICIAL_OWNERSHIP]: 4_200,
    [UNDERWRITING]: 4_100,
    [LOCK_UP]: 11_600,
  },
  "s1_1816017_000119312526173846.htm": {
    [PROSPECTUS_SUMMARY]: 1_400,
    [UNDERWRITING]: 3_700,
  },
  "s1_1817004_000149315226027137.htm": {
    [PROSPECTUS_SUMMARY]: 7_500,
    [RISK_FACTORS]: 2_900,
    [UNDERWRITING]: 2_500,
  },
  "s1_1822912_000121390021001475.htm": {
    [PROSPECTUS_SUMMARY]: 59_600,
    [THE_OFFERING]: 30_500,
    [RISK_FACTORS]: 86_000,
    [USE_OF_PROCEEDS]: 9_100,
    [MANAGEMENT]: 16_800,
    [BENEFICIAL_OWNERSHIP]: 4_700,
    [RELATED_PARTY]: 5_900,
    [UNDERWRITING]: 16_100,
    [EXECUTIVE_COMPENSATION]: 12_900,
  },
  "s1_1848507_000119312521066104.htm": {
    [PROSPECTUS_SUMMARY]: 63_500,
    [THE_OFFERING]: 37_700,
    [RISK_FACTORS]: 96_100,
    [USE_OF_PROCEEDS]: 7_500,
    [RELATED_PARTY]: 4_200,
    [MANAGEMENT]: 25_000,
    [EXECUTIVE_COMPENSATION]: 1_600,
    [BENEFICIAL_OWNERSHIP]: 6_600,
    [UNDERWRITING]: 14_200,
  },
  "s1_1849380_000149315226031598.htm": {
    [PROSPECTUS_SUMMARY]: 33_900,
    [RISK_FACTORS]: 30_000,
    [MANAGEMENT]: 10_600,
    [EXECUTIVE_COMPENSATION]: 6_300,
    [RELATED_PARTY]: 6_100,
    [UNDERWRITING]: 2_900,
  },
  "s1_1849470_000110465921035696.htm": {
    [PROSPECTUS_SUMMARY]: 55_400,
    [THE_OFFERING]: 32_700,
    [RISK_FACTORS]: 83_300,
    [USE_OF_PROCEEDS]: 8_700,
    [MANAGEMENT]: 21_300,
    [BENEFICIAL_OWNERSHIP]: 5_400,
    [RELATED_PARTY]: 6_000,
    [UNDERWRITING]: 18_800,
    [EXECUTIVE_COMPENSATION]: 11_600,
    [LOCK_UP]: 2_900,
  },
  "s1_1853138_000162828026039200.htm": {
    [PROSPECTUS_SUMMARY]: 21_200,
    [THE_OFFERING]: 1_800,
    [RISK_FACTORS]: 104_500,
    [MANAGEMENT]: 19_900,
    [EXECUTIVE_COMPENSATION]: 43_400,
    [UNDERWRITING]: 5_400,
  },
  "s1_1880613_000162828026005423.htm": {
    [PROSPECTUS_SUMMARY]: 21_700,
    [THE_OFFERING]: 1_300,
    [RISK_FACTORS]: 59_500,
    [USE_OF_PROCEEDS]: 1_000,
    [MANAGEMENT]: 9_600,
    [EXECUTIVE_COMPENSATION]: 12_300,
    [RELATED_PARTY]: 9_700,
    [BENEFICIAL_OWNERSHIP]: 5_600,
    [UNDERWRITING]: 3_100,
  },
  "s1_1918102_000110465926016226.htm": {
    [PROSPECTUS_SUMMARY]: 10_700,
    [THE_OFFERING]: 1_200,
    [RISK_FACTORS]: 51_700,
    [MANAGEMENT]: 7_600,
    [EXECUTIVE_COMPENSATION]: 14_900,
    [RELATED_PARTY]: 5_800,
    [BENEFICIAL_OWNERSHIP]: 3_400,
    [UNDERWRITING]: 5_300,
    [LOCK_UP]: 4_700,
  },
  "s1_1925283_000162828026027260.htm": {
    [PROSPECTUS_SUMMARY]: 49_700,
    [RISK_FACTORS]: 80_000,
    [USE_OF_PROCEEDS]: 1_300,
    [MANAGEMENT]: 15_100,
    [EXECUTIVE_COMPENSATION]: 19_700,
    [RELATED_PARTY]: 22_800,
    [BENEFICIAL_OWNERSHIP]: 10_900,
    [UNDERWRITING]: 20_900,
    [LOCK_UP]: 12_600,
  },
  "s1_2030954_000149315226027129.htm": {
    [PROSPECTUS_SUMMARY]: 3_900,
    [THE_OFFERING]: 1_800,
    [RISK_FACTORS]: 4_400,
    [USE_OF_PROCEEDS]: 1_100,
    [BENEFICIAL_OWNERSHIP]: 2_100,
    [UNDERWRITING]: 12_800,
    [LOCK_UP]: 10_800,
  },
  "s1_2049662_000110465926079324.htm": {
    [PROSPECTUS_SUMMARY]: 48_200,
    [THE_OFFERING]: 2_400,
    [RISK_FACTORS]: 80_000,
    [RELATED_PARTY]: 12_300,
    [MANAGEMENT]: 13_300,
    [EXECUTIVE_COMPENSATION]: 32_400,
    [BENEFICIAL_OWNERSHIP]: 4_600,
    [UNDERWRITING]: 9_300,
  },
  "s1_2075109_000121390026073335.htm": {
    [PROSPECTUS_SUMMARY]: 9_500,
    [THE_OFFERING]: 1_400,
    [RISK_FACTORS]: 52_700,
    [MANAGEMENT]: 7_100,
    [EXECUTIVE_COMPENSATION]: 9_700,
    [RELATED_PARTY]: 9_400,
    [BENEFICIAL_OWNERSHIP]: 2_800,
    [UNDERWRITING]: 5_300,
    [LOCK_UP]: 1_700,
  },
  "s1_2087989_000143774926019444.htm": {
    [PROSPECTUS_SUMMARY]: 9_900,
    [THE_OFFERING]: 4_900,
    [RISK_FACTORS]: 26_100,
    [UNDERWRITING]: 2_400,
    [THE_SPONSOR]: 4_500,
  },
  "s1_2091349_000119312526214778.htm": {
    [PROSPECTUS_SUMMARY]: 47_100,
    [RISK_FACTORS]: 97_800,
    [MANAGEMENT]: 14_800,
    [EXECUTIVE_COMPENSATION]: 31_800,
    [BENEFICIAL_OWNERSHIP]: 1_800,
    [RELATED_PARTY]: 3_600,
    [UNDERWRITING]: 4_500,
    [LOCK_UP]: 2_400,
  },
  "s1_2093507_000182912626003406.htm": {
    [PROSPECTUS_SUMMARY]: 30_300,
    [THE_OFFERING]: 3_700,
    [RISK_FACTORS]: 53_700,
    [USE_OF_PROCEEDS]: 1_400,
    [MANAGEMENT]: 17_000,
    [EXECUTIVE_COMPENSATION]: 7_900,
    [RELATED_PARTY]: 5_900,
    [BENEFICIAL_OWNERSHIP]: 2_700,
    [UNDERWRITING]: 7_400,
    [LOCK_UP]: 2_700,
  },
  "s1_2098410_000110465926086682.htm": {
    [PROSPECTUS_SUMMARY]: 42_000,
    [THE_SPONSOR]: 10_700,
    [THE_OFFERING]: 52_500,
    [RISK_FACTORS]: 133_900,
    [USE_OF_PROCEEDS]: 8_800,
    [MANAGEMENT]: 26_500,
    [BENEFICIAL_OWNERSHIP]: 8_700,
    [RELATED_PARTY]: 8_800,
    [UNDERWRITING]: 23_400,
    [EXECUTIVE_COMPENSATION]: 19_300,
    [LOCK_UP]: 22_100,
  },
  "s1_2105318_000149315226031978.htm": {
    [PROSPECTUS_SUMMARY]: 78_100,
    [THE_OFFERING]: 37_700,
    [RISK_FACTORS]: 136_800,
    [USE_OF_PROCEEDS]: 8_800,
    [MANAGEMENT]: 17_400,
    [BENEFICIAL_OWNERSHIP]: 5_600,
    [RELATED_PARTY]: 5_500,
    [UNDERWRITING]: 20_000,
    [EXECUTIVE_COMPENSATION]: 11_800,
  },
  "s1_2110105_000162828026032836.htm": {
    [PROSPECTUS_SUMMARY]: 42_200,
    [THE_OFFERING]: 3_100,
    [RISK_FACTORS]: 153_300,
    [USE_OF_PROCEEDS]: 1_300,
    [MANAGEMENT]: 18_900,
    [EXECUTIVE_COMPENSATION]: 18_600,
    [RELATED_PARTY]: 34_800,
    [BENEFICIAL_OWNERSHIP]: 9_800,
    [UNDERWRITING]: 24_300,
    [LOCK_UP]: 12_600,
  },
  "s1_2110119_000121390026072712.htm": {
    [PROSPECTUS_SUMMARY]: 87_900,
    [THE_OFFERING]: 49_900,
    [RISK_FACTORS]: 131_800,
    [USE_OF_PROCEEDS]: 7_200,
    [MANAGEMENT]: 23_200,
    [BENEFICIAL_OWNERSHIP]: 12_300,
    [RELATED_PARTY]: 7_700,
    [UNDERWRITING]: 22_500,
    [EXECUTIVE_COMPENSATION]: 17_000,
    [LOCK_UP]: 21_300,
  },
  "s1_2113481_000121390026068811.htm": {
    [PROSPECTUS_SUMMARY]: 101_200,
    [THE_OFFERING]: 47_400,
    [RISK_FACTORS]: 123_200,
    [USE_OF_PROCEEDS]: 7_200,
    [MANAGEMENT]: 28_900,
    [BENEFICIAL_OWNERSHIP]: 12_300,
    [RELATED_PARTY]: 6_600,
    [UNDERWRITING]: 24_000,
    [EXECUTIVE_COMPENSATION]: 17_200,
    [LOCK_UP]: 22_700,
  },
  "s1_2114227_000121390026039320.htm": {
    [PROSPECTUS_SUMMARY]: 92_200,
    [THE_OFFERING]: 45_300,
    [RISK_FACTORS]: 122_900,
    [USE_OF_PROCEEDS]: 9_800,
    [MANAGEMENT]: 28_000,
    [BENEFICIAL_OWNERSHIP]: 6_300,
    [RELATED_PARTY]: 7_100,
    [UNDERWRITING]: 14_400,
    [EXECUTIVE_COMPENSATION]: 20_300,
  },
  "s1_2114229_000121390026078277.htm": {
    [PROSPECTUS_SUMMARY]: 93_000,
    [THE_OFFERING]: 45_400,
    [RISK_FACTORS]: 123_600,
    [USE_OF_PROCEEDS]: 9_800,
    [MANAGEMENT]: 28_500,
    [BENEFICIAL_OWNERSHIP]: 6_300,
    [RELATED_PARTY]: 7_100,
    [UNDERWRITING]: 14_400,
    [EXECUTIVE_COMPENSATION]: 20_400,
  },
  "s1_2116230_000192998026000257.htm": {
    [PROSPECTUS_SUMMARY]: 108_400,
    [THE_OFFERING]: 44_900,
    [RISK_FACTORS]: 153_600,
    [USE_OF_PROCEEDS]: 8_000,
    [MANAGEMENT]: 15_800,
    [BENEFICIAL_OWNERSHIP]: 8_300,
    [UNDERWRITING]: 20_500,
    [EXECUTIVE_COMPENSATION]: 11_400,
    [LOCK_UP]: 2_600,
  },
  "s1_2123955_000121390026080433.htm": {
    [PROSPECTUS_SUMMARY]: 39_200,
    [THE_OFFERING]: 43_000,
    [RISK_FACTORS]: 128_600,
    [USE_OF_PROCEEDS]: 8_400,
    [MANAGEMENT]: 24_400,
    [BENEFICIAL_OWNERSHIP]: 7_800,
    [RELATED_PARTY]: 6_600,
    [UNDERWRITING]: 18_200,
    [EXECUTIVE_COMPENSATION]: 19_000,
  },
  "s1_2128045_000121390026070217.htm": {
    [PROSPECTUS_SUMMARY]: 88_700,
    [THE_OFFERING]: 46_600,
    [RISK_FACTORS]: 127_300,
    [USE_OF_PROCEEDS]: 8_000,
    [MANAGEMENT]: 23_400,
    [BENEFICIAL_OWNERSHIP]: 12_100,
    [RELATED_PARTY]: 7_400,
    [UNDERWRITING]: 9_500,
    [EXECUTIVE_COMPENSATION]: 16_600,
    [LOCK_UP]: 5_700,
  },
  "s1_2131350_000119312526294964.htm": {
    [PROSPECTUS_SUMMARY]: 96_900,
    [THE_OFFERING]: 42_500,
    [RISK_FACTORS]: 120_400,
    [USE_OF_PROCEEDS]: 9_700,
    [MANAGEMENT]: 30_100,
    [BENEFICIAL_OWNERSHIP]: 7_100,
    [RELATED_PARTY]: 7_500,
    [UNDERWRITING]: 14_200,
    [EXECUTIVE_COMPENSATION]: 17_400,
  },
  "s1_2133239_000192998026000317.htm": {
    [PROSPECTUS_SUMMARY]: 111_000,
    [THE_OFFERING]: 47_200,
    [RISK_FACTORS]: 153_500,
    [USE_OF_PROCEEDS]: 7_800,
    [MANAGEMENT]: 16_400,
    [BENEFICIAL_OWNERSHIP]: 8_300,
    [UNDERWRITING]: 20_100,
    [EXECUTIVE_COMPENSATION]: 12_300,
    [LOCK_UP]: 2_600,
  },
  "s1_2134856_000182912626007847.htm": {
    [PROSPECTUS_SUMMARY]: 70_700,
    [THE_OFFERING]: 75_400,
    [RISK_FACTORS]: 164_900,
    [USE_OF_PROCEEDS]: 6_700,
    [MANAGEMENT]: 28_500,
    [EXECUTIVE_COMPENSATION]: 20_000,
    [BENEFICIAL_OWNERSHIP]: 8_400,
    [RELATED_PARTY]: 8_700,
    [UNDERWRITING]: 17_000,
    [LOCK_UP]: 6_700,
  },
  "s1_2135163_000182912626006553.htm": {
    [PROSPECTUS_SUMMARY]: 30_000,
    [THE_OFFERING]: 55_600,
    [USE_OF_PROCEEDS]: 5_400,
    [MANAGEMENT]: 19_600,
    [BENEFICIAL_OWNERSHIP]: 3_600,
    [RELATED_PARTY]: 4_400,
    [UNDERWRITING]: 18_800,
    [EXECUTIVE_COMPENSATION]: 15_800,
    [LOCK_UP]: 2_900,
  },
  "s1_2136360_000213636026000003.htm": {
    [PROSPECTUS_SUMMARY]: 90_000,
    [THE_OFFERING]: 47_700,
    [RISK_FACTORS]: 125_700,
    [USE_OF_PROCEEDS]: 7_300,
    [BENEFICIAL_OWNERSHIP]: 8_300,
    [RELATED_PARTY]: 7_700,
    [UNDERWRITING]: 22_100,
    [LOCK_UP]: 20_900,
  },
  "s1_2137679_000182912626006500.htm": {
    [PROSPECTUS_SUMMARY]: 30_300,
    [THE_OFFERING]: 55_100,
    [USE_OF_PROCEEDS]: 5_600,
    [MANAGEMENT]: 20_000,
    [BENEFICIAL_OWNERSHIP]: 3_600,
    [RELATED_PARTY]: 4_500,
    [UNDERWRITING]: 18_900,
    [EXECUTIVE_COMPENSATION]: 15_100,
    [LOCK_UP]: 2_700,
  },
  "s1_2137965_000119312526308950.htm": {
    [PROSPECTUS_SUMMARY]: 76_400,
    [THE_OFFERING]: 36_200,
    [RISK_FACTORS]: 155_400,
    [USE_OF_PROCEEDS]: 7_000,
    [MANAGEMENT]: 21_600,
    [BENEFICIAL_OWNERSHIP]: 8_900,
    [RELATED_PARTY]: 5_500,
    [UNDERWRITING]: 20_500,
    [EXECUTIVE_COMPENSATION]: 14_700,
  },
  "s1_2147219_000110465926092088.htm": {
    [PROSPECTUS_SUMMARY]: 68_300,
    [THE_OFFERING]: 40_000,
    [RISK_FACTORS]: 117_300,
    [USE_OF_PROCEEDS]: 7_200,
    [MANAGEMENT]: 21_000,
    [BENEFICIAL_OWNERSHIP]: 4_900,
    [RELATED_PARTY]: 5_700,
    [UNDERWRITING]: 22_900,
    [EXECUTIVE_COMPENSATION]: 14_500,
  },
  "s1_95572_000121390026086369.htm": {
    [PROSPECTUS_SUMMARY]: 19_500,
    [THE_OFFERING]: 3_100,
    [RISK_FACTORS]: 57_300,
    [USE_OF_PROCEEDS]: 1_600,
    [MANAGEMENT]: 12_200,
    [EXECUTIVE_COMPENSATION]: 9_600,
    [RELATED_PARTY]: 6_700,
    [BENEFICIAL_OWNERSHIP]: 1_700,
    [UNDERWRITING]: 9_900,
    [LOCK_UP]: 2_100,
  },
};

/**
 * Page furniture (a per-page "Table of Contents" back-link, a running issuer
 * header) recurs far more often than any real heading — three occurrences is
 * the most any genuine heading reaches across this corpus. Furniture that
 * survives into the tree becomes a section, and every such section closes the
 * one it interrupts, so this bound guards the truncation mechanism directly and
 * independently of the per-section sizes above.
 */
const MAX_REPEATED_SECTION_TITLE = 5;

const fixtures = readdirSync(dir).filter((f) => f.endsWith(".htm"));

describe("parseEdgarHtml golden fixtures (real EDGAR S-1 filings)", () => {
  it("has a sample including at least three SPACs", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
    expect(SPAC_FIXTURES.every((f) => fixtures.includes(f))).toBe(true);
  });

  for (const file of fixtures) {
    const html = readFileSync(join(dir, file), "utf8");

    it(`${file}: parses real markup into a rich tree (no content collapse)`, () => {
      const doc = parseEdgarHtml(html, file);
      const nodes = [...traverseDepthFirst(doc)];
      // A full prospectus must not collapse (the page-container regression
      // dropped a 12 MB filing to ~6 nodes).
      expect(nodes.length).toBeGreaterThan(50);
      expect(nodes.filter((n) => n.kind === NodeKind.SECTION).length).toBeGreaterThan(10);
      expect(nodes.filter((n) => n.kind === NodeKind.TABLE).length).toBeGreaterThan(5);
    });

    it(`${file}: resolves exactly its expected target sections`, () => {
      const expected = EXPECTED[file];
      expect(expected, `add an EXPECTED entry for ${file}`).toBeDefined();
      const doc = parseEdgarHtml(html, file);
      const resolved = new DocumentTreeSegmenter().segment(doc).map((s) => s.name);
      expect(new Set(resolved)).toEqual(new Set(expected));
    });

    it(`${file}: every resolved section carries a full body, not a truncated one`, () => {
      const floors = MIN_SECTION_CHARS[file];
      expect(floors, `add a MIN_SECTION_CHARS entry for ${file}`).toBeDefined();
      const doc = parseEdgarHtml(html, file);
      const sizes = new Map(
        new DocumentTreeSegmenter().segment(doc).map((s) => [s.name, s.text.length])
      );
      for (const [name, min] of Object.entries(floors) as [S1SectionName, number][]) {
        expect(sizes.get(name) ?? 0, `${file} ${name} body`).toBeGreaterThanOrEqual(min);
      }
    });

    it(`${file}: no page furniture survives as a repeated section`, () => {
      const doc = parseEdgarHtml(html, file);
      const counts = new Map<string, number>();
      for (const node of traverseDepthFirst(doc)) {
        if (node.kind !== NodeKind.SECTION) continue;
        const title = (node as SectionNode).title.replace(/\s+/g, " ").trim().toLowerCase();
        counts.set(title, (counts.get(title) ?? 0) + 1);
      }
      for (const [title, n] of counts) {
        expect(n, `${file} repeats section "${title}"`).toBeLessThan(MAX_REPEATED_SECTION_TITLE);
      }
    });

    it(`${file}: no stitched table leaves a duplicated header row in its body`, () => {
      const doc = parseEdgarHtml(html, file);
      const tables = [...traverseDepthFirst(doc)].filter(
        (n) => n.kind === NodeKind.TABLE
      ) as TableNode[];
      for (const t of tables) {
        if (t.stitchedFrom > 1 && t.headerRows.length > 0) {
          const headerKey = t.headerRows[0].map((c) => c.text.trim()).join("|");
          expect(t.rows.some((r) => r.map((c) => c.text.trim()).join("|") === headerKey)).toBe(
            false
          );
        }
      }
    });
  }

  it("extracts all three target sections from every SPAC fixture", () => {
    for (const file of SPAC_FIXTURES) {
      const doc = parseEdgarHtml(readFileSync(join(dir, file), "utf8"), file);
      const resolved = new Set(new DocumentTreeSegmenter().segment(doc).map((s) => s.name));
      expect(resolved.has(MANAGEMENT), `${file} management`).toBe(true);
      expect(resolved.has(BENEFICIAL_OWNERSHIP), `${file} ownership`).toBe(true);
      expect(resolved.has(RELATED_PARTY), `${file} related-party`).toBe(true);
    }
  });
});
