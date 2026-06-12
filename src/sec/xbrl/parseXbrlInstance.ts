/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import * as cheerio from "cheerio";
import type { CheerioAcceptedNode, DomElement } from "./domNodes";
import {
  collectNamespacePrefixes,
  getAttr,
  localName,
  namespaceForQName,
  normalizeFactValue,
  parseContextElement,
  parseUnitElement,
} from "./parseXbrlCore";
import type { XbrlContext, XbrlDocument, XbrlFact, XbrlUnit } from "./types";

/**
 * Parses a standalone XBRL instance document (EX-101.INS): contexts, units,
 * and every element carrying a contextRef attribute as a fact. Instance values
 * are already lexical XML values, so no ixt transforms / sign / scale apply.
 */
export function parseXbrlInstance(xml: string): XbrlDocument {
  const prefixes = collectNamespacePrefixes(xml);
  const $ = cheerio.load(xml, { xml: true });

  const rootEl = $(":root")
    .toArray()
    .find((el) => localName((el as DomElement).tagName) === "xbrl") as DomElement | undefined;
  if (!rootEl) {
    return { facts: [], contexts: new Map(), units: new Map(), hasXbrl: false };
  }

  const contexts = new Map<string, XbrlContext>();
  const units = new Map<string, XbrlUnit>();
  const facts: XbrlFact[] = [];
  let order = 0;

  const visit = (el: DomElement): void => {
    const local = localName(el.tagName);
    if (local === "context") {
      const ctx = parseContextElement($, el);
      if (ctx !== null) contexts.set(ctx.id, ctx);
      return;
    }
    if (local === "unit") {
      const unit = parseUnitElement($, el);
      if (unit !== null) units.set(unit.id, unit);
      return;
    }

    const contextRef = getAttr(el, "contextRef");
    if (contextRef !== null) {
      const concept = el.tagName;
      const unitRef = getAttr(el, "unitRef");
      const isNumeric = unitRef !== null;
      const isNil = (getAttr(el, "xsi:nil") ?? "").toLowerCase() === "true";
      const rawText = $(el as CheerioAcceptedNode).text();
      const { value, numericValue } = normalizeFactValue({
        rawText,
        format: null,
        scale: null,
        sign: null,
        isNumeric,
        isNil,
      });
      facts.push({
        concept,
        namespace: namespaceForQName(prefixes, concept),
        contextRef,
        unitRef,
        rawText: rawText.trim(),
        value,
        numericValue,
        decimals: getAttr(el, "decimals"),
        scale: null,
        sign: null,
        format: null,
        isNil,
        isNumeric,
        isHidden: false,
        order: order++,
        source: "instance",
      });
      return; // tuples are rare in EDGAR; nested facts under a fact are not expected
    }

    for (const child of el.children) {
      if (child.type === "tag") visit(child as DomElement);
    }
  };

  for (const child of rootEl.children) {
    if (child.type === "tag") visit(child as DomElement);
  }

  return { facts, contexts, units, hasXbrl: true };
}
