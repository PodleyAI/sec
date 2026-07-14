/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CheerioAPI } from "cheerio";
import type { ResolvedStyle } from "./types";

const BASE_PT = 10;
const PX_TO_PT = 0.75;

interface RawStyle {
  fontWeight: number | undefined;
  italic: boolean | undefined;
  underline: boolean | undefined;
  centered: boolean | undefined;
  fontSizePt: number | undefined;
}

/** Map a legacy HTML `<font size="1..7">` attribute to an approximate point size. */
function fontSizeAttrToPt(size: string | undefined): number | undefined {
  if (size === undefined) return undefined;
  const n = Number(size.trim());
  // size 3 is the browser default (~12pt); 1–2 are smaller, 4–7 progressively larger.
  const map: Record<number, number> = { 1: 7.5, 2: 10, 3: 12, 4: 13.5, 5: 18, 6: 24, 7: 36 };
  return Number.isFinite(n) ? map[n] : undefined;
}

function parseInlineStyle(style: string): RawStyle {
  const decls = new Map<string, string>();
  for (const part of style.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    decls.set(part.slice(0, idx).trim().toLowerCase(), part.slice(idx + 1).trim().toLowerCase());
  }
  const weightRaw = decls.get("font-weight");
  let fontWeight: number | undefined;
  if (weightRaw === "bold" || weightRaw === "bolder") fontWeight = 700;
  else if (weightRaw === "normal") fontWeight = 400;
  else if (weightRaw && /^\d+$/.test(weightRaw)) fontWeight = Number(weightRaw);

  const fontStyle = decls.get("font-style");
  const textDecoration = decls.get("text-decoration");
  const align = decls.get("text-align");

  let fontSizePt: number | undefined;
  const size = decls.get("font-size");
  if (size) {
    const m = size.match(/([\d.]+)(pt|px)?/);
    if (m) {
      const n = Number(m[1]);
      fontSizePt = m[2] === "px" ? n * PX_TO_PT : n;
    }
  }
  return {
    fontWeight,
    italic: fontStyle === "italic" ? true : fontStyle === "normal" ? false : undefined,
    underline: textDecoration?.includes("underline"),
    centered: align === "center" ? true : align ? false : undefined,
    fontSizePt,
  };
}

function upperRatio(text: string): number {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length === 0) return 0;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length;
}

/** Resolve the effective style of `el` by merging ancestor inline styles (child wins). */
export function resolveStyle($: CheerioAPI, el: unknown): ResolvedStyle {
  const $el = $(el as never);
  const chain: RawStyle[] = [];
  const tagNames: string[] = [];
  let cur = $(el as never);
  while (cur && cur.length > 0 && cur.get(0)) {
    const node = cur.get(0) as unknown as { tagName?: string; name?: string };
    const tag = (node.tagName ?? node.name ?? "").toLowerCase();
    tagNames.push(tag);
    const raw = parseInlineStyle(cur.attr("style") ?? "");
    // Legacy EDGAR uses the HTML attribute <font size="N"> rather than a CSS
    // font-size; fold it in when no inline size is present.
    let merged =
      raw.fontSizePt === undefined && tag === "font"
        ? { ...raw, fontSizePt: fontSizeAttrToPt(cur.attr("size")) }
        : raw;
    // Likewise ALIGN="center" rather than a CSS text-align — pre-CSS EDGAR
    // markup centers headings with the attribute (<P ALIGN="center"><B>The
    // Offering</B></P>), which heading detection must count as a trait.
    if (merged.centered === undefined) {
      const alignAttr = (cur.attr("align") ?? "").trim().toLowerCase();
      if (alignAttr !== "") merged = { ...merged, centered: alignAttr === "center" };
    }
    chain.push(merged);
    cur = cur.parent() as unknown as typeof cur;
    if (!cur || cur.length === 0) break;
  }

  const pick = <K extends keyof RawStyle>(key: K): RawStyle[K] => {
    for (const s of chain) if (s[key] !== undefined) return s[key];
    return undefined;
  };

  // Emphasis can come from a semantic tag on the element itself, ANY ancestor
  // (CSS inheritance), or an inner emphasis tag that wraps the text — EDGAR
  // headings are commonly `<p><b>MANAGEMENT</b></p>`. A bare `<b>`/`<font>`
  // carries no inline style, so the cascade alone misses these.
  const inChainOrDescendant = (...tags: string[]): boolean =>
    tags.some((t) => tagNames.includes(t)) || $el.find(tags.join(",")).length > 0;
  const tagBold = inChainOrDescendant("b", "strong");
  const tagItalic = inChainOrDescendant("i", "em");
  const tagUnderline = inChainOrDescendant("u");

  // A descendant <font size="N"> (e.g. <div><font size="5">RISK FACTORS</font></div>)
  // sets the effective size too; take the largest descendant size if the cascade
  // gave none.
  let fontSizePt = pick("fontSizePt");
  if (fontSizePt === undefined) {
    $el.find("font[size]").each((_, f) => {
      const pt = fontSizeAttrToPt($(f as never).attr("size"));
      if (pt !== undefined && (fontSizePt === undefined || pt > fontSizePt)) fontSizePt = pt;
    });
  }

  const text = $el.text();
  return {
    fontSizePt: fontSizePt ?? BASE_PT,
    bold: (pick("fontWeight") ?? 400) >= 600 || tagBold,
    italic: pick("italic") ?? tagItalic,
    underline: pick("underline") ?? tagUnderline ?? false,
    centered: pick("centered") ?? false,
    upperRatio: upperRatio(text),
  };
}

/** Count independent emphasis traits used by HeadingDetector's gate. */
export function emphasisTraitCount(s: ResolvedStyle): number {
  let n = 0;
  if (s.bold) n++;
  if (s.centered) n++;
  if (s.fontSizePt > BASE_PT) n++;
  if (s.upperRatio >= 0.8) n++;
  if (s.underline) n++;
  return n;
}
