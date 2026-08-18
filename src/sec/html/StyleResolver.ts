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
  /** `text-transform: uppercase` — the text READS as caps whatever the source says. */
  uppercased: boolean | undefined;
}

/** Map a legacy HTML `<font size="1..7">` attribute to an approximate point size. */
function fontSizeAttrToPt(size: string | undefined): number | undefined {
  if (size === undefined) return undefined;
  const n = Number(size.trim());
  // size 3 is the browser default (~12pt); 1–2 are smaller, 4–7 progressively larger.
  const map: Record<number, number> = { 1: 7.5, 2: 10, 3: 12, 4: 13.5, 5: 18, 6: 24, 7: 36 };
  return Number.isFinite(n) ? map[n] : undefined;
}

/**
 * Convert a CSS length to points. Every unit must land on one scale: heading
 * ranking compares these magnitudes directly, so reading "120%" as 120pt would
 * rank a slightly-enlarged heading above every genuinely larger one. Relative
 * units resolve against BASE_PT rather than the true parent size — `pick` gives
 * the nearest styled ancestor, not a computed cascade — which is approximate but
 * keeps sizes ordered.
 */
function parseFontSizePt(size: string): number | undefined {
  const m = size.match(/^([\d.]+)\s*(pt|px|em|rem|%)?/);
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(n)) return undefined;
  switch (m?.[2]) {
    case "px":
      return n * PX_TO_PT;
    case "%":
      return (n / 100) * BASE_PT;
    case "em":
    case "rem":
      return n * BASE_PT;
    // "pt" and the unit-less legacy form (invalid CSS, but present in real
    // EDGAR markup) are already points.
    default:
      return n;
  }
}

/** Keywords that may precede the size in a `font` shorthand and are not weights. */
const FONT_SHORTHAND_SKIP = new Set([
  "small-caps",
  "all-small-caps",
  "petite-caps",
  "titling-caps",
  "unicase",
  "condensed",
  "expanded",
  "semi-condensed",
  "semi-expanded",
  "extra-condensed",
  "extra-expanded",
  "ultra-condensed",
  "ultra-expanded",
]);

/**
 * Expand the `font` shorthand into the longhands this resolver reads.
 *
 * Not a nicety: it is how a large share of EDGAR filings express emphasis at
 * all. Older filing agents write `font: bold 10pt Times New Roman, Times, Serif`
 * where newer ones write `font-weight:700;font-size:10pt`, and the shorthand
 * form dominates where it appears — Constellation's 2021 S-1 carries 3,048
 * shorthand declarations against 256 `font-weight`, and Inception's has 410
 * against ZERO. Reading only the longhands makes every heading in such a filing
 * invisible, which is what left those documents unsegmentable.
 *
 * Grammar: `[style|variant|weight|stretch]* <size>[/<line-height>] <family>`.
 * Everything before the size is an unordered keyword set, so walk until a token
 * parses as a size. Omitted sub-properties reset to their initial values per
 * spec, which matters here — `font: 10pt Arial` inside a bold ancestor is NOT
 * bold — so absent style/weight are written as explicit "normal" rather than
 * left undefined for the ancestor chain to fill in.
 */
function expandFontShorthand(value: string, decls: Map<string, string>): void {
  // `font: inherit | caption | menu | ...` set no size we can read; the system
  // font keywords in particular carry no usable size or weight.
  if (!/\d/.test(value)) return;
  let weight = "normal";
  let style = "normal";
  let sizePt: number | undefined;

  for (const token of value.split(/\s+/)) {
    if (token === "") continue;
    if (token === "italic" || token === "oblique") style = token;
    else if (token === "bold" || token === "bolder") weight = "700";
    else if (token === "lighter") weight = "300";
    // A bare multiple-of-100 is a WEIGHT, not a size: inside the shorthand the
    // size must carry a unit (or be a keyword), so `font: italic 700 12pt Arial`
    // means weight 700 at 12pt. Checked before the size branch, which would
    // otherwise swallow the 700 and abandon the whole declaration. The unit-less
    // font-size the LONGHAND tolerates is invalid here.
    else if (/^[1-9]00$/.test(token)) weight = token;
    else if (token === "normal" || FONT_SHORTHAND_SKIP.has(token)) continue;
    else {
      // The size ends the keyword prefix; `10pt/1.2` carries line-height after.
      const candidate = token.split("/")[0] ?? "";
      if (/^[\d.]/.test(candidate)) {
        sizePt = parseFontSizePt(candidate);
        break;
      }
      // Anything else is the family starting without a size — malformed; stop
      // rather than mistake a family name for a keyword.
      break;
    }
  }

  // A shorthand with no readable size is malformed (family is required after
  // it); trust none of it rather than resetting weight off a bad parse.
  if (sizePt === undefined) return;
  decls.set("font-weight", weight);
  decls.set("font-style", style);
  decls.set("font-size", `${sizePt}pt`);
}

function parseInlineStyle(style: string): RawStyle {
  const decls = new Map<string, string>();
  for (const part of style.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part
      .slice(idx + 1)
      .trim()
      .toLowerCase();
    // Expanded in declaration order, writing into the same map the longhands
    // use, so precedence is CSS's own last-wins: a longhand after the shorthand
    // overrides it, and a shorthand after a longhand resets it.
    if (key === "font") expandFontShorthand(value, decls);
    else decls.set(key, value);
  }
  const weightRaw = decls.get("font-weight");
  let fontWeight: number | undefined;
  if (weightRaw === "bold" || weightRaw === "bolder") fontWeight = 700;
  else if (weightRaw === "normal") fontWeight = 400;
  else if (weightRaw && /^\d+$/.test(weightRaw)) fontWeight = Number(weightRaw);

  const fontStyle = decls.get("font-style");
  const textDecoration = decls.get("text-decoration");
  const align = decls.get("text-align");
  // Heading rank counts ALL-CAPS as an emphasis trait, but reads it off the
  // source text — so a filing that writes `Risk Factors` and uppercases it in
  // CSS scored as mixed case and ranked BELOW a literal `THE OFFERING`
  // elsewhere. In Constellation's S-1 that inverted the tree: every real
  // section became a child of the summary's offering table, which then absorbed
  // 574k characters. `none`/`lowercase`/`capitalize` are recorded as an explicit
  // false so they stop an inherited uppercase, which is how CSS behaves.
  const textTransform = decls.get("text-transform");

  const size = decls.get("font-size");
  const fontSizePt = size ? parseFontSizePt(size) : undefined;
  return {
    fontWeight,
    italic: fontStyle === "italic" ? true : fontStyle === "normal" ? false : undefined,
    underline: textDecoration?.includes("underline"),
    centered: align === "center" ? true : align ? false : undefined,
    fontSizePt,
    uppercased:
      textTransform === "uppercase" ? true : textTransform !== undefined ? false : undefined,
  };
}

function upperRatio(text: string): number {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length === 0) return 0;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length;
}

/** Element traits gathered from a single descendant walk. */
interface DescendantTraits {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Largest `<font size="N">` among descendants, in points. */
  maxFontSizePt: number | undefined;
}

/**
 * Emphasis tags and legacy font sizes anywhere below `el`, in one pass.
 *
 * These were four separate `$el.find(...)` calls; each runs the selector engine
 * over the whole subtree, and `resolveStyle` is called once per prose block, so
 * on a large filing the four walks dominated style resolution.
 */
function scanDescendants(el: unknown): DescendantTraits {
  const traits: DescendantTraits = {
    bold: false,
    italic: false,
    underline: false,
    maxFontSizePt: undefined,
  };
  const visit = (node: unknown): void => {
    const children = (node as { children?: unknown[] }).children;
    if (children === undefined) return;
    for (const child of children) {
      const c = child as { name?: string; attribs?: Record<string, string> };
      // Text, comment and doctype nodes carry no tag name.
      if (c.name === undefined) continue;
      switch (c.name.toLowerCase()) {
        case "b":
        case "strong":
          traits.bold = true;
          break;
        case "i":
        case "em":
          traits.italic = true;
          break;
        case "u":
          traits.underline = true;
          break;
        case "font": {
          const pt = fontSizeAttrToPt(c.attribs?.size);
          if (pt !== undefined && (traits.maxFontSizePt === undefined || pt > traits.maxFontSizePt))
            traits.maxFontSizePt = pt;
          break;
        }
      }
      visit(child);
    }
  };
  visit(el);
  return traits;
}

/** Resolve the effective style of `el` by merging ancestor inline styles (child wins). */
export function resolveStyle($: CheerioAPI, el: unknown): ResolvedStyle {
  const $el = $(el as never);
  const chain: RawStyle[] = [];
  const tagNames: string[] = [];
  // Raw domhandler traversal rather than `cur.parent()`: the cheerio wrapper
  // allocated an object per ancestor, per block.
  let cur = el as
    { name?: string; attribs?: Record<string, string>; parent?: unknown } | null | undefined;
  while (cur) {
    const tag = (cur.name ?? "").toLowerCase();
    tagNames.push(tag);
    const attribs = cur.attribs;
    const raw = parseInlineStyle(attribs?.style ?? "");
    // Legacy EDGAR uses the HTML attribute <font size="N"> rather than a CSS
    // font-size; fold it in when no inline size is present.
    let merged =
      raw.fontSizePt === undefined && tag === "font"
        ? { ...raw, fontSizePt: fontSizeAttrToPt(attribs?.size) }
        : raw;
    // Likewise ALIGN="center" rather than a CSS text-align — pre-CSS EDGAR
    // markup centers headings with the attribute (<P ALIGN="center"><B>The
    // Offering</B></P>), which heading detection must count as a trait.
    if (merged.centered === undefined) {
      const alignAttr = (attribs?.align ?? "").trim().toLowerCase();
      if (alignAttr !== "") merged = { ...merged, centered: alignAttr === "center" };
    }
    chain.push(merged);
    cur = cur.parent as typeof cur;
  }

  const pick = <K extends keyof RawStyle>(key: K): RawStyle[K] => {
    for (const s of chain) if (s[key] !== undefined) return s[key];
    return undefined;
  };

  // Emphasis can come from a semantic tag on the element itself, ANY ancestor
  // (CSS inheritance), or an inner emphasis tag that wraps the text — EDGAR
  // headings are commonly `<p><b>MANAGEMENT</b></p>`. A bare `<b>`/`<font>`
  // carries no inline style, so the cascade alone misses these.
  const descendants = scanDescendants(el);
  const inChainOrDescendant = (fromDescendant: boolean, ...tags: string[]): boolean =>
    tags.some((t) => tagNames.includes(t)) || fromDescendant;
  const tagBold = inChainOrDescendant(descendants.bold, "b", "strong");
  const tagItalic = inChainOrDescendant(descendants.italic, "i", "em");
  const tagUnderline = inChainOrDescendant(descendants.underline, "u");

  // A descendant <font size="N"> (e.g. <div><font size="5">RISK FACTORS</font></div>)
  // sets the effective size too; take the largest descendant size if the cascade
  // gave none.
  const fontSizePt = pick("fontSizePt") ?? descendants.maxFontSizePt;

  const text = $el.text();
  return {
    fontSizePt: fontSizePt ?? BASE_PT,
    bold: (pick("fontWeight") ?? 400) >= 600 || tagBold,
    italic: pick("italic") ?? tagItalic,
    underline: pick("underline") ?? tagUnderline ?? false,
    centered: pick("centered") ?? false,
    // CSS uppercasing makes the rendered text all-caps regardless of how the
    // source spells it, so it counts as fully upper for ranking purposes.
    upperRatio: pick("uppercased") === true ? 1 : upperRatio(text),
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
