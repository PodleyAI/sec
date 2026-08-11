/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

const SHORT_LEN = 100;

/** A centered bare page number or "Page N" footer line. */
export function isPageNumber(text: string): boolean {
  const t = text.trim();
  if (t.length > SHORT_LEN) return false;
  return /^\W*page\s+\d+\W*$/i.test(t) || /^[-\s]*\d{1,4}[-\s]*$/.test(t);
}

/**
 * Per-page "Table of Contents" back-link text. Exact match only — the real TOC
 * section title is usually a heading (`TABLE OF CONTENTS`) and must stay.
 */
export function isTocBackLink(text: string): boolean {
  return /^table of contents$/i.test(text.replace(/\s+/g, " ").trim());
}

/** Leaf prose that must not coalesce with adjacent body text. */
export function isPageFurniture(text: string): boolean {
  return isTocBackLink(text) || isPageNumber(text);
}
