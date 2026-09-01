/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CheerioAPI } from "cheerio";
import type { TableCell, TableNode } from "workglow";
import { NodeKind, renderMarkdown, uuid4 } from "workglow";
import { parseNumeric } from "./parseNumeric";
import { extractTable } from "./TableExtractor";

const SUM1_CLASS = /(?:^|\s)[\w-]*sum1(?:\s|$)/i;
const SUM2_CLASS = /(?:^|\s)[\w-]*sum2(?:\s|$)/i;
const OFFERING_LABEL =
  /securities offered|number of units(?: offered)?|offering price|units offered/i;

interface CssLengths {
  readonly marginLeft: number | undefined;
  readonly marginTop: number | undefined;
  readonly width: number | undefined;
  readonly floatLeft: boolean;
}

interface Pair {
  label: string;
  value: string;
}

function attribsOf(el: unknown): Record<string, string> | undefined {
  return (el as { attribs?: Record<string, string> }).attribs;
}

function tagName(el: unknown): string {
  const node = el as { tagName?: string; name?: string; type?: string };
  return (node.tagName ?? node.name ?? "").toLowerCase();
}

function parsePt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const m = raw.trim().match(/^(-?[\d.]+)\s*(pt|px|in|em)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  switch ((m[2] ?? "pt").toLowerCase()) {
    case "px":
      return n * 0.75;
    case "in":
      return n * 72;
    case "em":
      return n * 10;
    default:
      return n;
  }
}

function cssLengths(style: string | undefined): CssLengths {
  const map = new Map<string, string>();
  for (const part of (style ?? "").split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    map.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
  }
  return {
    marginLeft: parsePt(map.get("margin-left")),
    marginTop: parsePt(map.get("margin-top")),
    width: parsePt(map.get("width")),
    floatLeft: /^\s*left\s*$/i.test(map.get("float") ?? ""),
  };
}

function textOf($: CheerioAPI, el: unknown): string {
  return $(el as never)
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

function isElement(el: unknown): boolean {
  const type = (el as { type?: string }).type;
  return type === "tag" || type === "script" || type === "style";
}

/** Whitespace, comments, `<br>`, and typesetter spacer divs between hanging-indent rows. */
export function isSkippedSibling($: CheerioAPI, el: unknown): boolean {
  const type = (el as { type?: string }).type;
  if (type === "text") {
    return ((el as { data?: string }).data ?? "").replace(/\s+/g, "").length === 0;
  }
  if (type === "comment") return true;
  if (!isElement(el)) return false;
  const tag = tagName(el);
  if (tag === "br") return true;
  const style = attribsOf(el)?.style ?? "";
  const text = textOf($, el).replace(/\u200b/g, "");
  if (text.length === 0) return true;
  if (/font-size\s*:\s*0/i.test(style) && /line-height\s*:\s*0/i.test(style)) return true;
  return false;
}

function nextMeaningful($: CheerioAPI, children: readonly unknown[], start: number): number {
  let i = start;
  while (i < children.length && isSkippedSibling($, children[i])) i += 1;
  return i;
}

function looksLikeCssLabel($: CheerioAPI, el: unknown): boolean {
  if (!isElement(el)) return false;
  const cls = attribsOf(el)?.class ?? "";
  if (SUM1_CLASS.test(cls)) return true;
  const box = cssLengths(attribsOf(el)?.style);
  if (box.width === undefined || box.width < 72 || box.width > 288) return false;
  if (box.marginLeft !== undefined && box.marginLeft > 24) return false;
  const text = textOf($, el);
  return text.length > 0 && text.length <= 120 && !text.includes(". ");
}

function looksLikeCssValue($: CheerioAPI, el: unknown): boolean {
  if (!isElement(el)) return false;
  const cls = attribsOf(el)?.class ?? "";
  if (SUM2_CLASS.test(cls)) return true;
  const box = cssLengths(attribsOf(el)?.style);
  return (
    box.marginTop !== undefined &&
    box.marginTop < 0 &&
    box.marginLeft !== undefined &&
    box.marginLeft >= 96
  );
}

function isBulletGlyph($: CheerioAPI, el: unknown): boolean {
  if (!isElement(el)) return false;
  const box = cssLengths(attribsOf(el)?.style);
  if (!box.floatLeft) return false;
  if (box.width !== undefined && box.width > 24) return false;
  const text = textOf($, el);
  return text.length > 0 && text.length <= 4;
}

function isContinuation($: CheerioAPI, el: unknown, valueMarginLeft: number): boolean {
  if (!isElement(el)) return false;
  if (looksLikeCssValue($, el)) return true;
  if (tagName(el) === "table") {
    const left = cssLengths(attribsOf(el)?.style).marginLeft ?? 0;
    return left >= valueMarginLeft - 24;
  }
  const box = cssLengths(attribsOf(el)?.style);
  const left = box.marginLeft;
  if (left !== undefined && left >= valueMarginLeft - 8) return true;
  return isBulletGlyph($, el);
}

function cell(text: string): TableCell {
  return { text, colspan: 1, rowspan: 1, isHeader: false, numeric: parseNumeric(text) };
}

function tableFromPairs(pairs: readonly Pair[]): TableNode {
  const rows = pairs.map((p) => [cell(p.label), cell(p.value)]);
  const node: TableNode = {
    nodeId: uuid4(),
    kind: NodeKind.TABLE,
    range: { startOffset: 0, endOffset: 0 },
    text: "",
    caption: undefined,
    columnCount: 2,
    headerRows: [],
    rows,
    stitchedFrom: 1,
  };
  return { ...node, text: renderMarkdown(node) };
}

function appendTableRows($: CheerioAPI, pairs: Pair[], el: unknown): void {
  const t = extractTable($, el);
  for (const row of [...t.headerRows, ...t.rows]) {
    const label = row[0]?.text ?? "";
    const value = row
      .slice(1)
      .map((c) => c.text)
      .join(" ")
      .trim();
    pairs.push({ label, value });
  }
}

/**
 * If `children[start]` opens a CSS hanging-indent two-column run (Donnelley
 * `sum1`/`sum2` or Workiva width + negative `margin-top`), consume the run into
 * one GFM table. Returns undefined when the node is not such a run.
 */
export function consumeCssTwoColumnRun(
  $: CheerioAPI,
  children: readonly unknown[],
  start: number
): { readonly table: TableNode; readonly nextIndex: number } | undefined {
  if (start >= children.length || !looksLikeCssLabel($, children[start])) return undefined;

  const pairs: Pair[] = [];
  let i = start;
  let valueMarginLeft = 168;

  while (i < children.length) {
    i = nextMeaningful($, children, i);
    if (i >= children.length) break;
    if (!looksLikeCssLabel($, children[i])) break;
    const labelIndex = i;
    const label = textOf($, children[i]);
    i = nextMeaningful($, children, i + 1);
    if (i >= children.length || !looksLikeCssValue($, children[i])) {
      i = labelIndex;
      break;
    }
    const valueEl = children[i];
    const valueBox = cssLengths(attribsOf(valueEl)?.style);
    valueMarginLeft = valueBox.marginLeft ?? valueMarginLeft;
    pairs.push({ label, value: textOf($, valueEl) });
    i += 1;

    while (true) {
      const j = nextMeaningful($, children, i);
      if (j >= children.length) {
        i = j;
        break;
      }
      const cont = children[j];
      if (looksLikeCssLabel($, cont)) {
        i = j;
        break;
      }
      if (!isContinuation($, cont, valueMarginLeft)) {
        i = j;
        break;
      }
      if (tagName(cont) === "table") {
        appendTableRows($, pairs, cont);
        i = j + 1;
        continue;
      }
      if (isBulletGlyph($, cont)) {
        const k = nextMeaningful($, children, j + 1);
        const value = k < children.length ? textOf($, children[k]) : "";
        pairs.push({ label: textOf($, cont), value });
        i = k < children.length ? k + 1 : j + 1;
        continue;
      }
      pairs.push({ label: "", value: textOf($, cont) });
      i = j + 1;
    }
  }

  if (pairs.length === 0) return undefined;
  if (pairs.length < 2 && !OFFERING_LABEL.test(pairs[0]?.label ?? "")) return undefined;
  return { table: tableFromPairs(pairs), nextIndex: i };
}
