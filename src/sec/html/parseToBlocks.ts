/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import * as cheerio from "cheerio";
import type { ImageNode, ListNode, ParagraphNode } from "workglow";
import { NodeKind, uuid4 } from "workglow";
import { consumeCssTwoColumnRun } from "./cssTwoColumnTable";
import { isHidden, stripNonProse } from "./domPrep";
import { assignHeadingLevels, isHeadingCandidate } from "./HeadingDetector";
import { isPageFurniture } from "./pageFurniture";
import { resolveStyle } from "./StyleResolver";
import { extractTable, isLayoutTable, leadingOfferingCaption } from "./TableExtractor";
import type { EdgarBlock, ResolvedStyle, SourceSpan } from "./types";

const BLOCK_TAGS = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th"]);

/** An element's raw attributes, or undefined for text/comment nodes. */
function attribsOf(el: unknown): Record<string, string> | undefined {
  return (el as { attribs?: Record<string, string> }).attribs;
}

/**
 * The `[startIndex, endIndex)` parse5 recorded for a node, or undefined for one
 * parse5 synthesized rather than read — an implied `<tbody>`, or the
 * `<html>`/`<body>` inserted for a filing that omits them. A synthesized node
 * spans no source text, so folding its (absent) location into a span would
 * silently widen the span to whatever the fallback guessed.
 */
function spanOf(el: unknown): SourceSpan | undefined {
  const node = el as { startIndex?: number | null; endIndex?: number | null };
  const { startIndex, endIndex } = node;
  if (typeof startIndex !== "number" || typeof endIndex !== "number") return undefined;
  return { start: startIndex, end: endIndex };
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

/**
 * The span covering `children[from .. to-1]`, or undefined when parse5 located
 * none of them. Used for a block synthesized from a run of siblings, which has
 * no single element of its own to read a location from.
 */
function runSpan(children: readonly unknown[], from: number, to: number): SourceSpan | undefined {
  let start = -1;
  let end = -1;
  for (let i = from; i < to && i < children.length; i++) {
    const span = spanOf(children[i]);
    if (span === undefined) continue;
    if (start === -1 || span.start < start) start = span.start;
    if (span.end > end) end = span.end;
  }
  return start === -1 ? undefined : { start, end };
}

/**
 * Prose gathered from consecutive leaf nodes, with the span of HTML it came
 * from. A coalesced paragraph has many contributing DOM nodes — the run they
 * cover is contiguous in document order, so the union of their spans is the
 * paragraph's span.
 *
 * `start`/`end` are -1 while nothing locatable has been added, which is
 * distinguishable from a real span at offset 0.
 */
interface ProseRun {
  readonly parts: string[];
  start: number;
  end: number;
}

function addProse(run: ProseRun, text: string, span: SourceSpan | undefined): void {
  run.parts.push(text);
  if (span === undefined) return;
  if (run.start === -1 || span.start < run.start) run.start = span.start;
  if (span.end > run.end) run.end = span.end;
}

function takeProseText(run: ProseRun): string {
  const text = run.parts
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  run.parts.length = 0;
  return text;
}

function makeParagraph(text: string): ParagraphNode {
  return {
    nodeId: uuid4(),
    kind: NodeKind.PARAGRAPH,
    range: { startOffset: 0, endOffset: 0 },
    text,
  };
}

/**
 * Walk the EDGAR HTML DOM in document order, emitting a flat EdgarBlock[]:
 * heading candidates, coalesced prose paragraphs, tables, lists, images, and
 * page-break markers. Heading levels are assigned in a second pass.
 */
export function parseToBlocks(html: string): EdgarBlock[] {
  // Source locations are what every block's `source` span is read from. parse5
  // records them for element AND text nodes, and the cost is in the noise: on a
  // 1.57 MB S-1 the load measured 186 ms with them against 193 ms without.
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true });

  // Drop non-prose subtrees and comments at the DOM level before any prose walk
  // runs. Removing them here (rather than skipping tags mid-walk) ensures
  // nested descendants — svg > title/desc/foreignObject, math > mtext, template
  // shadow content — cannot leak into `.text()` calls performed elsewhere.
  stripNonProse($);

  const out: EdgarBlock[] = [];
  const prose: ProseRun = { parts: [], start: -1, end: -1 };

  // Furthest source offset any located node has reached. It positions a block
  // parse5 gave no location for, as a zero-width mark in document order rather
  // than a span claiming text the walk cannot account for.
  let cursor = 0;

  /** A block's span, or a zero-width mark at the position reached so far. */
  const sourceAt = (span: SourceSpan | undefined): SourceSpan => {
    if (span === undefined) return { start: cursor, end: cursor };
    if (span.end > cursor) cursor = span.end;
    return span;
  };

  /** Close the open prose run, emitting it as one paragraph if it has text. */
  const flushProse = (): void => {
    const span = prose.start === -1 ? undefined : { start: prose.start, end: prose.end };
    const text = takeProseText(prose);
    prose.start = -1;
    prose.end = -1;
    if (text.length === 0) return;
    out.push({ type: "paragraph", node: makeParagraph(text), source: sourceAt(span) });
  };

  const root = $("body").get(0) ?? $.root().get(0)!;

  const walk = (el: unknown): void => {
    const node = el as { tagName?: string; name?: string; type?: string };
    const tag = (node.tagName ?? node.name ?? "").toLowerCase();

    if (isPageBreak(el)) {
      flushProse();
      out.push({ type: "page-break", source: sourceAt(spanOf(el)) });
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
    if (isHidden(el)) return;

    if (tag === "table") {
      flushProse();
      if (isLayoutTable($, el)) {
        descend(el);
        return;
      }
      // Read before the caption row is removed below: removing a node clears
      // nothing on its siblings, but the table's own span must be taken from
      // the markup as parsed, not from whatever survives the peel.
      const span = spanOf(el);
      const caption = leadingOfferingCaption($, el);
      if (caption !== undefined) {
        descend(caption.cell);
        $(caption.row as never).remove();
        out.push({ type: "table", node: extractTable($, el), source: sourceAt(span) });
        return;
      }
      out.push({ type: "table", node: extractTable($, el), source: sourceAt(span) });
      return; // do not descend; cells handled inside extractTable
    }

    if (tag === "ul" || tag === "ol") {
      flushProse();
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
        out.push({ type: "list", node: list, source: sourceAt(spanOf(el)) });
      }
      return;
    }

    if (tag === "img") {
      const src = $(el as never).attr("src") ?? "";
      if (src.length > 0) {
        flushProse();
        const alt = $(el as never).attr("alt");
        const image: ImageNode = {
          nodeId: uuid4(),
          kind: NodeKind.IMAGE,
          range: { startOffset: 0, endOffset: 0 },
          text: `![${alt ?? ""}](${src})`,
          src,
          alt: alt ?? undefined,
        };
        out.push({ type: "image", node: image, source: sourceAt(spanOf(el)) });
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
        const span = spanOf(el);
        if (semantic) {
          flushProse();
          const headingStyle: ResolvedStyle = {
            ...style,
            bold: true,
            fontSizePt: 22 - (Number(semantic[1]) - 1) * 2,
          };
          out.push({
            type: "heading",
            text,
            style: headingStyle,
            level: 1,
            source: sourceAt(span),
          });
        } else if (isHeadingCandidate(text, style)) {
          flushProse();
          out.push({ type: "heading", text, style, level: 1, source: sourceAt(span) });
        } else if (isPageFurniture(text)) {
          // Flush first so a TOC back-link / page number never joins the
          // previous or next body paragraph — coalesced furniture is unique
          // long text the de-paginator cannot frequency-match or page-number
          // drop, and is what leaked into every extractor prompt.
          flushProse();
          out.push({ type: "paragraph", node: makeParagraph(text), source: sourceAt(span) });
        } else {
          addProse(prose, text, span);
        }
        return;
      }
    }

    descend(el);
  };

  // Walk an element's children in document order: text nodes feed the prose
  // buffer, element nodes recurse through `walk`. CSS hanging-indent
  // two-column runs are consumed as one table before any child is walked, so
  // a label/value pair cannot split into adjacent paragraphs.
  function descend(el: unknown): void {
    const children = (el as { children?: unknown[] }).children ?? [];
    let i = 0;
    while (i < children.length) {
      const child = children[i];
      const cn = child as { type?: string; data?: string };
      if (cn.type === "text") {
        const t = (cn.data ?? "").replace(/\s+/g, " ").trim();
        if (t.length > 0) addProse(prose, t, spanOf(child));
        i += 1;
        continue;
      }
      const run = consumeCssTwoColumnRun($, children, i);
      if (run !== undefined) {
        flushProse();
        // The run is children[i .. nextIndex-1]; its span is the first child's
        // start to the last consumed child's end, since the two-column builder
        // returns a synthesized table with no source of its own.
        out.push({
          type: "table",
          node: run.table,
          source: sourceAt(runSpan(children, i, run.nextIndex)),
        });
        i = run.nextIndex;
        continue;
      }
      walk(child);
      i += 1;
    }
  }

  walk(root);
  flushProse();

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
