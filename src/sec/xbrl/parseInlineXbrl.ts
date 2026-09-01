/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import * as cheerio from "cheerio";
import type { DomElement, DomNode, DomTextNode } from "./domNodes";
import {
  collectNamespacePrefixes,
  getAttr,
  INLINE_XBRL_NAMESPACES,
  localName,
  namespaceForQName,
  normalizeFactValue,
  parseContextElement,
  parseUnitElement,
  prefixForNamespace,
  XBRL_INSTANCE_NAMESPACE,
} from "./parseXbrlCore";
import type { XbrlContext, XbrlDocument, XbrlFact, XbrlUnit } from "./types";

/**
 * Text content of an inline fact element, dropping ix:exclude subtrees (their
 * content is presentation-only and not part of the fact value).
 */
function factText(el: DomElement, ixPrefix: string): string {
  const excludeTag = `${ixPrefix}:exclude`;
  const parts: string[] = [];
  const walk = (node: DomNode): void => {
    if (node.type === "text") {
      parts.push((node as DomTextNode).data);
      return;
    }
    if (node.type === "tag" || node.type === "script" || node.type === "style") {
      const child = node as DomElement;
      if (child.tagName.toLowerCase() === excludeTag) return;
      for (const c of child.children) walk(c);
    }
  };
  for (const c of el.children) walk(c);
  return parts.join("");
}

/** Follows a continuedAt chain, concatenating continuation text. Cycle-safe. */
function resolveContinuations(
  el: DomElement,
  ixPrefix: string,
  continuations: ReadonlyMap<string, DomElement>
): string {
  let text = factText(el, ixPrefix);
  let nextId = getAttr(el, "continuedAt");
  const seen = new Set<string>();
  while (nextId !== null && !seen.has(nextId)) {
    seen.add(nextId);
    const cont = continuations.get(nextId);
    if (!cont) break;
    text += factText(cont, ixPrefix);
    nextId = getAttr(cont, "continuedAt");
  }
  return text;
}

function hasHiddenAncestor(el: DomElement, hiddenTag: string): boolean {
  let parent = el.parent;
  while (parent !== null) {
    if (parent.type === "tag" && (parent as DomElement).tagName.toLowerCase() === hiddenTag) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function parseIntAttr(el: DomElement, name: string): number | null {
  const raw = getAttr(el, name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses inline XBRL (iXBRL) facts, contexts, and units out of EDGAR filing
 * HTML. Returns an empty document (hasXbrl: false) when the HTML declares no
 * inline-XBRL namespace. Pure and synchronous; tolerant of missing pieces
 * (facts referencing unknown contexts are still returned).
 */
export function parseInlineXbrl(html: string): XbrlDocument {
  const prefixes = collectNamespacePrefixes(html);
  const ixPrefix = prefixForNamespace(prefixes, INLINE_XBRL_NAMESPACES, "ix").toLowerCase();
  const declaresInline =
    [...prefixes.values()].some((uri) =>
      (INLINE_XBRL_NAMESPACES as readonly string[]).includes(uri)
    ) || /<ix:(nonfraction|nonnumeric|header)/i.test(html);
  if (!declaresInline) {
    return { facts: [], contexts: new Map(), units: new Map(), hasXbrl: false };
  }

  const $ = cheerio.load(html);
  const xbrliPrefix = prefixForNamespace(
    prefixes,
    [XBRL_INSTANCE_NAMESPACE],
    "xbrli"
  ).toLowerCase();

  const contexts = new Map<string, XbrlContext>();
  for (const el of $(`${xbrliPrefix}\\:context, context`).toArray() as DomElement[]) {
    const ctx = parseContextElement($, el);
    if (ctx !== null) contexts.set(ctx.id, ctx);
  }

  const units = new Map<string, XbrlUnit>();
  for (const el of $(`${xbrliPrefix}\\:unit, unit`).toArray() as DomElement[]) {
    const unit = parseUnitElement($, el);
    if (unit !== null) units.set(unit.id, unit);
  }

  const continuations = new Map<string, DomElement>();
  for (const el of $(`${ixPrefix}\\:continuation`).toArray() as DomElement[]) {
    const id = getAttr(el, "id");
    if (id !== null) continuations.set(id, el);
  }

  const hiddenTag = `${ixPrefix}:hidden`;
  const facts: XbrlFact[] = [];
  let order = 0;
  for (const el of $(
    `${ixPrefix}\\:nonfraction, ${ixPrefix}\\:nonnumeric`
  ).toArray() as DomElement[]) {
    const concept = getAttr(el, "name");
    if (concept === null) continue;

    const isNumeric = localName(el.tagName) === "nonfraction";
    const rawText = resolveContinuations(el, ixPrefix, continuations);
    const format = getAttr(el, "format");
    const scale = isNumeric ? parseIntAttr(el, "scale") : null;
    const sign = getAttr(el, "sign") === "-" ? ("-" as const) : null;
    const isNil = (getAttr(el, "xsi:nil") ?? "").toLowerCase() === "true";

    const { value, numericValue } = normalizeFactValue({
      rawText,
      format,
      scale,
      sign,
      isNumeric,
      isNil,
    });

    facts.push({
      concept,
      namespace: namespaceForQName(prefixes, concept),
      contextRef: getAttr(el, "contextRef"),
      unitRef: getAttr(el, "unitRef"),
      rawText: rawText.trim(),
      value,
      numericValue,
      decimals: getAttr(el, "decimals"),
      scale,
      sign,
      format,
      isNil,
      isNumeric,
      isHidden: hasHiddenAncestor(el, hiddenTag),
      order: order++,
      source: "inline",
    });
  }

  return { facts, contexts, units, hasXbrl: true };
}
