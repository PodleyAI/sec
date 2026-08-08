/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import * as cheerio from "cheerio";
import { NodeKind, uuid4 } from "workglow";
import type { ImageNode, ListNode, ParagraphNode } from "workglow";
import type { EdgarBlock, ResolvedStyle } from "./types";
import { resolveStyle } from "./StyleResolver";
import { isHeadingCandidate, assignHeadingLevels } from "./HeadingDetector";
import { extractTable } from "./TableExtractor";

const BLOCK_TAGS = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th"]);

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
const STRIP_BEFORE_WALK_SELECTOR =
  "script, style, noscript, textarea, template, xmp, plaintext, " +
  "iframe, noembed, noframes, title, svg, math";

/** An element's raw attributes, or undefined for text/comment nodes. */
function attribsOf(el: unknown): Record<string, string> | undefined {
  return (el as { attribs?: Record<string, string> }).attribs;
}

/** True if `el` has a CSS/structural page-break signal (edgartools heuristics). */
function isPageBreak(el: unknown): boolean {
  const node = el as { tagName?: string; name?: string };
  const tag = (node.tagName ?? node.name ?? "").toLowerCase();
  const attribs = attribsOf(el);
  const style = (attribs?.style ?? "").toLowerCase();
  const cls = (attribs?.class ?? "").toLowerCase();
  if (/page-break-(before|after)\s*:\s*always/.test(style)) return true;
  if (cls.includes("pagebreak") || cls.includes("brpfpagebreak")) return true;
  if (tag === "hr") {
    if (/height\s*:\s*3pt/.test(style)) return true;
    if (/page-break/.test(style)) return true;
  }
  if (tag === "div") {
    if (/height\s*:\s*(842\.4|792|1008)pt/.test(style)) return true;
  }
  return false;
}

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

function emitProse(buffer: string[], out: EdgarBlock[]): void {
  const text = buffer
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  buffer.length = 0;
  if (text.length === 0) return;
  const node: ParagraphNode = {
    nodeId: uuid4(),
    kind: NodeKind.PARAGRAPH,
    range: { startOffset: 0, endOffset: 0 },
    text,
  };
  out.push({ type: "paragraph", node });
}

/**
 * Walk the EDGAR HTML DOM in document order, emitting a flat EdgarBlock[]:
 * heading candidates, coalesced prose paragraphs, tables, lists, images, and
 * page-break markers. Heading levels are assigned in a second pass.
 */
export function parseToBlocks(html: string): EdgarBlock[] {
  const $ = cheerio.load(html);

  // Drop non-prose subtrees at the DOM level before any prose walk runs.
  // Removing them here (rather than skipping tags mid-walk) ensures nested
  // descendants — svg > title/desc/foreignObject, math > mtext, template
  // shadow content — cannot leak into `.text()` calls performed elsewhere.
  $(STRIP_BEFORE_WALK_SELECTOR).remove();

  // Defense-in-depth: strip HTML comments. Cheerio treats them as nodes with
  // `type === "comment"`, and while the walker only reads element/text
  // children, any consumer that later calls `.text()` on a raw parent would
  // otherwise see their contents.
  //
  // Collected with one linear DOM walk rather than `$("*").contents()`, whose
  // cost grows superlinearly with element count: on a 7 MB S-1 (63k elements)
  // that single call took ~14s of a ~16s parse, and found no comments at all.
  for (const comment of collectComments($.root().get(0))) {
    $(comment as never).remove();
  }

  const out: EdgarBlock[] = [];
  const prose: string[] = [];

  const root = $("body").get(0) ?? $.root().get(0)!;

  const walk = (el: unknown): void => {
    const node = el as { tagName?: string; name?: string; type?: string };
    const tag = (node.tagName ?? node.name ?? "").toLowerCase();

    if (isPageBreak(el)) {
      emitProse(prose, out);
      out.push({ type: "page-break" });
      // EDGAR wraps each page's content in a page-sized container element (e.g.
      // <div style="height:792pt">...page content...</div>). Descend into it so
      // that content is not dropped; an empty marker (<hr>, empty <div>) has no
      // children, making this a no-op.
      descend(el);
      return;
    }

    // The pre-walk `.remove()` on {@link STRIP_BEFORE_WALK_SELECTOR} already
    // dropped these subtrees; the mid-walk guard is defense-in-depth against
    // a future consumer that reloads DOM state.
    if (tag === "script" || tag === "style") return;

    // display:none subtrees are invisible to a reader and, in iXBRL filings,
    // hold the ix:header metadata block (contexts, units, hidden facts) whose
    // text must not leak into prose. The XBRL pass parses them separately.
    if (/display\s*:\s*none/i.test(attribsOf(el)?.style ?? "")) return;

    if (tag === "table") {
      emitProse(prose, out);
      out.push({ type: "table", node: extractTable($, el) });
      return; // do not descend; cells handled inside extractTable
    }

    if (tag === "ul" || tag === "ol") {
      emitProse(prose, out);
      const items = $(el as never)
        .children("li")
        .toArray()
        .map((li) => $(li).text().replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 0);
      if (items.length > 0) {
        const list: ListNode = {
          nodeId: uuid4(),
          kind: NodeKind.LIST,
          range: { startOffset: 0, endOffset: 0 },
          text: items.map((it, i) => (tag === "ol" ? `${i + 1}. ${it}` : `- ${it}`)).join("\n"),
          ordered: tag === "ol",
          items,
        };
        out.push({ type: "list", node: list });
      }
      return;
    }

    if (tag === "img") {
      const src = $(el as never).attr("src") ?? "";
      if (src.length > 0) {
        emitProse(prose, out);
        const alt = $(el as never).attr("alt");
        const image: ImageNode = {
          nodeId: uuid4(),
          kind: NodeKind.IMAGE,
          range: { startOffset: 0, endOffset: 0 },
          text: `![${alt ?? ""}](${src})`,
          src,
          alt: alt ?? undefined,
        };
        out.push({ type: "image", node: image });
      }
      return;
    }

    if (BLOCK_TAGS.has(tag)) {
      const $el = $(el as never);
      // A block-level wrapper that contains another block, a table/list, or an
      // image must be descended into so those children are handled separately;
      // otherwise the wrapper is a leaf whose text joins the prose run. (img is
      // included so a logo/signature wrapped in <div>/<p> is not silently lost.)
      const hasBlockChild = $el
        .children()
        .toArray()
        .some((c) => {
          const cn = c as { tagName?: string; name?: string };
          const ct = (cn.tagName ?? cn.name ?? "").toLowerCase();
          return BLOCK_TAGS.has(ct) || ct === "table" || ct === "ul" || ct === "ol" || ct === "img";
        });
      if (!hasBlockChild) {
        const text = $el.text().replace(/\s+/g, " ").trim();
        if (text.length === 0) return;
        const style = resolveStyle($, el);
        // Semantic <h1>-<h6> are always headings; synthesize a size-ordered
        // style (h1 largest) so assignHeadingLevels ranks them even when the
        // filing applies no inline styling to the tag.
        const semantic = /^h([1-6])$/.exec(tag);
        if (semantic) {
          emitProse(prose, out);
          const headingStyle: ResolvedStyle = {
            ...style,
            bold: true,
            fontSizePt: 22 - (Number(semantic[1]) - 1) * 2,
          };
          out.push({ type: "heading", text, style: headingStyle, level: 1 });
        } else if (isHeadingCandidate(text, style)) {
          emitProse(prose, out);
          out.push({ type: "heading", text, style, level: 1 });
        } else {
          prose.push(text);
        }
        return;
      }
    }

    descend(el);
  };

  // Walk an element's children in document order: text nodes feed the prose
  // buffer, element nodes recurse through `walk`.
  function descend(el: unknown): void {
    for (const child of (el as { children?: unknown[] }).children ?? []) {
      const cn = child as { type?: string; data?: string };
      if (cn.type === "text") {
        const t = (cn.data ?? "").replace(/\s+/g, " ").trim();
        if (t.length > 0) prose.push(t);
      } else {
        walk(child);
      }
    }
  }

  walk(root);
  emitProse(prose, out);

  // Second pass: assign heading levels by first-appearance style ordering.
  const headingStyles: ResolvedStyle[] = out
    .filter((b): b is Extract<EdgarBlock, { type: "heading" }> => b.type === "heading")
    .map((b) => b.style);
  const levels = assignHeadingLevels(headingStyles);
  let hi = 0;
  for (const b of out) {
    if (b.type === "heading") {
      (b as { level: number }).level = levels[hi++];
    }
  }

  return out;
}
