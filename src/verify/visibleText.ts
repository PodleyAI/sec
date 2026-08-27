/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import * as cheerio from "cheerio";
import { isHidden, stripNonProse } from "../sec/html/domPrep";

/** One run of reader-visible text, with the span of HTML it occupies. */
export interface TextRun {
  readonly start: number;
  readonly end: number;
  /** Whitespace-collapsed content, which is what a reader sees. */
  readonly text: string;
}

/**
 * Every run of text a reader of the filing would see, in document order.
 *
 * This is the **independent** half of the coverage measurement: it applies the
 * same visibility rules the block walk does — {@link stripNonProse} for
 * non-prose subtrees and comments, {@link isHidden} for `display:none`, both
 * shared with the walk so the two cannot drift — and then stops. It runs none
 * of the walk's block-emission logic, so text the walk failed to turn into a
 * block still appears here. That difference is the whole point: a run present
 * here and claimed by no block is content the parser dropped silently.
 */
export function visibleTextRuns(html: string): readonly TextRun[] {
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true });
  stripNonProse($);
  const runs: TextRun[] = [];
  const visit = (node: unknown): void => {
    const el = node as {
      type?: string;
      data?: string;
      children?: unknown[];
      startIndex?: number | null;
      endIndex?: number | null;
    };
    if (el.type === "text") {
      const text = (el.data ?? "").replace(/\s+/g, " ").trim();
      if (text.length === 0) return;
      if (typeof el.startIndex !== "number" || typeof el.endIndex !== "number") return;
      runs.push({ start: el.startIndex, end: el.endIndex, text });
      return;
    }
    if (el.type !== "text" && isHidden(node)) return;
    for (const child of el.children ?? []) visit(child);
  };
  visit($.root().get(0));
  return runs;
}
