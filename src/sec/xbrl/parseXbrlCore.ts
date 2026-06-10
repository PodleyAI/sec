/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { applyIxtTransform } from "./ixtTransforms";
import type { XbrlContext, XbrlDimension, XbrlUnit } from "./types";

export const INLINE_XBRL_NAMESPACES = [
  "http://www.xbrl.org/2013/inlineXBRL",
  "http://www.xbrl.org/2008/inlineXBRL",
] as const;
export const XBRL_INSTANCE_NAMESPACE = "http://www.xbrl.org/2003/instance";

/**
 * Collects xmlns prefix declarations from the raw source. Declarations appear
 * on different elements per filer, so a single source-level scan (first
 * declaration wins) is the pragmatic resolution strategy.
 */
export function collectNamespacePrefixes(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /xmlns:([A-Za-z_][\w.-]*)\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (!map.has(m[1])) map.set(m[1], m[2]);
  }
  return map;
}

/** Finds the prefix bound to any of `uris`, else `fallback`. */
export function prefixForNamespace(
  prefixes: ReadonlyMap<string, string>,
  uris: readonly string[],
  fallback: string
): string {
  for (const [prefix, uri] of prefixes) {
    if (uris.includes(uri)) return prefix;
  }
  return fallback;
}

/** Namespace-URI lookup for a prefixed QName ("dei:DocumentType" -> dei's URI). */
export function namespaceForQName(
  prefixes: ReadonlyMap<string, string>,
  qname: string
): string | null {
  const idx = qname.indexOf(":");
  if (idx <= 0) return null;
  return prefixes.get(qname.slice(0, idx)) ?? null;
}

/** The local part of a possibly-prefixed tag name, lowercased. */
export function localName(tagName: string): string {
  const idx = tagName.indexOf(":");
  return (idx >= 0 ? tagName.slice(idx + 1) : tagName).toLowerCase();
}

/**
 * Case-insensitive attribute lookup: HTML-mode parsing lowercases attribute
 * names (contextRef -> contextref) while XML mode preserves them.
 */
export function getAttr(el: Element, name: string): string | null {
  const attribs = el.attribs ?? {};
  const lower = name.toLowerCase();
  for (const key of Object.keys(attribs)) {
    if (key.toLowerCase() === lower) return attribs[key];
  }
  return null;
}

function findByLocalName(el: Element, local: string): Element[] {
  const out: Element[] = [];
  const walk = (node: AnyNode): void => {
    if (node.type === "tag" || node.type === "script" || node.type === "style") {
      const child = node as Element;
      if (localName(child.tagName) === local) out.push(child);
      for (const c of child.children) walk(c);
    }
  };
  for (const c of el.children) walk(c);
  return out;
}

function textOf($: CheerioAPI, el: Element | undefined): string | null {
  if (!el) return null;
  const t = $(el).text().trim();
  return t.length > 0 ? t : null;
}

/** Parses one xbrli:context element (entity, period, segment/scenario dimensions). */
export function parseContextElement($: CheerioAPI, el: Element): XbrlContext | null {
  const id = getAttr(el, "id");
  if (id === null) return null;

  const identifierEl = findByLocalName(el, "identifier")[0];
  const entityIdentifier = textOf($, identifierEl);
  const entityScheme = identifierEl ? getAttr(identifierEl, "scheme") : null;

  const periodStart = textOf($, findByLocalName(el, "startdate")[0]);
  const periodEnd = textOf($, findByLocalName(el, "enddate")[0]);
  const periodInstant = textOf($, findByLocalName(el, "instant")[0]);
  const isForever = findByLocalName(el, "forever").length > 0;

  const dimensions: XbrlDimension[] = [];
  for (const member of findByLocalName(el, "explicitmember")) {
    const dimension = getAttr(member, "dimension");
    const value = textOf($, member);
    if (dimension !== null && value !== null) {
      dimensions.push({ dimension, member: value, isTyped: false });
    }
  }
  for (const member of findByLocalName(el, "typedmember")) {
    const dimension = getAttr(member, "dimension");
    const value = textOf($, member);
    if (dimension !== null && value !== null) {
      dimensions.push({ dimension, member: value, isTyped: true });
    }
  }

  return {
    id,
    entityIdentifier,
    entityScheme,
    periodStart,
    periodEnd,
    periodInstant,
    isForever,
    dimensions,
  };
}

/** "iso4217:USD" -> "USD", "xbrli:shares" -> "shares"; unknown prefixes keep the local part. */
function normalizeMeasure(measure: string): string {
  const idx = measure.indexOf(":");
  return idx >= 0 ? measure.slice(idx + 1) : measure;
}

/** Parses one xbrli:unit element, normalizing divide units to "num/den". */
export function parseUnitElement($: CheerioAPI, el: Element): XbrlUnit | null {
  const id = getAttr(el, "id");
  if (id === null) return null;

  const numerators = findByLocalName(el, "unitnumerator");
  const denominators = findByLocalName(el, "unitdenominator");
  if (numerators.length > 0 && denominators.length > 0) {
    const num = textOf($, findByLocalName(numerators[0], "measure")[0]);
    const den = textOf($, findByLocalName(denominators[0], "measure")[0]);
    if (num !== null && den !== null) {
      return { id, measure: `${normalizeMeasure(num)}/${normalizeMeasure(den)}` };
    }
  }
  const measure = textOf($, findByLocalName(el, "measure")[0]);
  return measure !== null ? { id, measure: normalizeMeasure(measure) } : { id, measure: "" };
}

export interface NormalizedFactValue {
  readonly value: string;
  readonly numericValue: number | null;
}

/**
 * Applies the ixt format transform, then (for numeric facts) sign and scale.
 * An unregistered transform keeps the raw text and yields a null numericValue
 * rather than guessing.
 */
export function normalizeFactValue(args: {
  readonly rawText: string;
  readonly format: string | null;
  readonly scale: number | null;
  readonly sign: "-" | null;
  readonly isNumeric: boolean;
  readonly isNil: boolean;
}): NormalizedFactValue {
  const { rawText, format, scale, sign, isNumeric, isNil } = args;
  if (isNil) return { value: "", numericValue: null };

  const transformed = applyIxtTransform(format, rawText);
  // Collapse internal whitespace (incl. non-breaking spaces in entity names).
  const value = (transformed ?? rawText.trim()).replace(/\s+/g, " ");
  if (!isNumeric) return { value, numericValue: null };
  if (transformed === null && format !== null) return { value, numericValue: null };

  const base = Number(value);
  if (!Number.isFinite(base)) return { value, numericValue: null };
  const scaled = base * Math.pow(10, scale ?? 0);
  return { value, numericValue: sign === "-" ? -scaled : scaled };
}
