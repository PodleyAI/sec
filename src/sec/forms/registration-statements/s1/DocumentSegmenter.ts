/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DocumentRootNode } from "workglow";

/** Canonical section names this spec extracts. */
export const S1_SECTIONS = {
  MANAGEMENT: "Management",
  BENEFICIAL_OWNERSHIP: "Principal and Selling Stockholders",
  RELATED_PARTY: "Certain Relationships and Related Transactions",
} as const;
export type S1SectionName = (typeof S1_SECTIONS)[keyof typeof S1_SECTIONS];

/** Accepted heading variants per canonical section (matched against a whole line). */
export const SECTION_HEADING_PATTERNS: Readonly<Record<S1SectionName, readonly RegExp[]>> = {
  [S1_SECTIONS.MANAGEMENT]: [
    /^\s*management\s*$/i,
    /^\s*(our\s+)?management\s*$/i,
    /^\s*executive officers(,| and)? (and )?directors\s*$/i,
    /^\s*directors and executive officers\s*$/i,
  ],
  [S1_SECTIONS.BENEFICIAL_OWNERSHIP]: [
    /^\s*principal (and selling )?stockholders\s*$/i,
    /^\s*principal (and selling )?shareholders\s*$/i,
    /^\s*security ownership[^\n]*\s*$/i,
    /^\s*beneficial ownership[^\n]*\s*$/i,
  ],
  [S1_SECTIONS.RELATED_PARTY]: [
    // "Related Person Transactions" is the modern SEC Item 404 wording and is
    // common in real filings alongside the older "Related Party Transactions".
    /^\s*certain relationships and related (party |person |persons )?transactions\s*$/i,
    /^\s*related (part(y|ies)|persons?) transactions\s*$/i,
    /^\s*transactions with related persons\s*$/i,
  ],
};

export interface Section {
  readonly name: S1SectionName;
  readonly text: string; // GFM rendering of the section subtree
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface DocumentSegmenter {
  /** Returns one Section per target heading found in the document tree. */
  segment(doc: DocumentRootNode): readonly Section[];
}
