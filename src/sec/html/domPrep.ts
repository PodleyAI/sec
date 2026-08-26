/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CheerioAPI } from "cheerio";

/**
 * Selector for elements whose contents must be dropped before prose is
 * gathered. Two classes:
 *
 * - HTML raw-text / RCDATA elements whose bodies are not rendered as prose
 *   (`script`, `style`, `noscript`, `textarea`, `template`, `xmp`,
 *   `plaintext`, `iframe`, `noembed`, `noframes`). A filer-planted
 *   `SYSTEM: hijack` inside these elements survives cheerio's `.text()`
 *   walks and would otherwise leak into the prompt for every downstream
 *   prose extractor.
 * - Body-level metadata (`title`) and foreign-content roots (`svg`,
 *   `math`) whose descendants (`svg > title/desc/foreignObject`,
 *   `math > mtext`) similarly slip past HTML block heuristics and can
 *   smuggle prompt-injection payloads.
 */
export const STRIP_BEFORE_WALK_SELECTOR =
  "script, style, noscript, textarea, template, xmp, plaintext, " +
  "iframe, noembed, noframes, title, svg, math";

/** Every comment node in the subtree, in document order. */
function collectComments(root: unknown): unknown[] {
  const found: unknown[] = [];
  const visit = (node: unknown): void => {
    const children = (node as { children?: unknown[] }).children;
    if (children === undefined) return;
    for (const child of children) {
      if ((child as { type?: string }).type === "comment") found.push(child);
      else visit(child);
    }
  };
  visit(root);
  return found;
}

/**
 * Remove everything that is not rendered prose: the
 * {@link STRIP_BEFORE_WALK_SELECTOR} subtrees and every HTML comment.
 *
 * Shared by the block walk and by the verification pass that measures how much
 * of a filing the walk accounted for. Two copies of these rules would make the
 * measurement meaningless the first time one of them learned about a new
 * element: the coverage number would move without the parser changing.
 *
 * Comments are collected with one linear DOM walk rather than
 * `$("*").contents()`, whose cost grows superlinearly with element count: on a
 * 7 MB S-1 (63k elements) that single call took ~14s of a ~16s parse, and found
 * no comments at all.
 */
export function stripNonProse($: CheerioAPI): void {
  $(STRIP_BEFORE_WALK_SELECTOR).remove();
  for (const comment of collectComments($.root().get(0))) {
    $(comment as never).remove();
  }
}

/** True when an element's inline style hides it (and its subtree) from a reader. */
export function isHidden(el: unknown): boolean {
  const style = (el as { attribs?: Record<string, string> }).attribs?.style ?? "";
  return /display\s*:\s*none/i.test(style);
}
