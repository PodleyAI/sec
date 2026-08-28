/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import {
  allRegisteredForms,
  extractorIdsForForm,
  registerFormExtractor,
} from "../../sec/forms/formExtractors";
import { PARSER_ONLY_FORMS_BY_EXTRACTOR } from "../../sec/forms/parserOnlyForms";
import { sortFormsForSweep } from "./formsSweepOrder";

// `sortFormsForSweep` ranks a form through the form-extractor registry, so an
// empty registry would rank every form the same and the order under test would
// not exist. Registering once per registry generation, this is a no-op wherever
// the extractors are already registered.
registerSecFormExtractors();

// This package parses the proxy family and does not read it — the `merger-proxy`
// extractor is supplied by a consumer — so those forms reach no sweep here at
// all. Their RANK still has to be right in a deployment that has that consumer,
// which is what `SWEEP_PRIORITY` keeps a slot for, so the order below is
// exercised against a stand-in registered over exactly the forms this package
// pins as parser-only. Without it the proxy link of the chain is untested
// rather than merely absent.
registerFormExtractor({
  id: "merger-proxy",
  forms: PARSER_ONLY_FORMS_BY_EXTRACTOR["merger-proxy"],
  store: async () => {},
});

/**
 * Every form any registered extractor handles — the same set the sweep's own
 * worklist draws from.
 */
function allForms(): readonly string[] {
  return allRegisteredForms();
}

/**
 * The extractor `sortFormsForSweep` ranks `form` by: the first one the registry
 * hands back. A form may carry several, and only one rank can be honoured in a
 * single ordered pass.
 */
function leadIdOf(form: string): string | undefined {
  return extractorIdsForForm(form)[0];
}

/** Index of the first form in `order` whose leading extractor is `extractorId`. */
function firstIndexOf(order: readonly string[], extractorId: string): number {
  const i = order.findIndex((form) => leadIdOf(form) === extractorId);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

describe("sortFormsForSweep", () => {
  it("runs S-1 before RW before 424 before 8-K before proxies before 25/15", () => {
    // Registration order is an accident of import order, so an unsorted sweep
    // could reach every issuer-filed Form 25 before its S-1 had minted the spac
    // row the deregistration handler is gated on. Form RW is the same gate.
    const order = sortFormsForSweep(allForms());
    const s1 = firstIndexOf(order, "S-1-xbrl");
    const rw = firstIndexOf(order, "RW");
    const p424 = firstIndexOf(order, "424-xbrl");
    const eightK = firstIndexOf(order, "8-K");
    const proxy = firstIndexOf(order, "merger-proxy");
    const dereg = firstIndexOf(order, "25-15");
    expect(s1).toBeLessThan(rw);
    expect(rw).toBeLessThan(p424);
    expect(p424).toBeLessThan(eightK);
    expect(eightK).toBeLessThan(proxy);
    expect(proxy).toBeLessThan(dereg);
  });

  it("puts every ranked form ahead of every unranked one", () => {
    const order = sortFormsForSweep(allForms());
    const ranked = new Set(["S-1-xbrl", "RW", "424-xbrl", "8-K", "merger-proxy", "25-15"]);
    const lastRanked = order.reduce(
      (acc, form, i) => (ranked.has(leadIdOf(form) ?? "") ? i : acc),
      -1
    );
    const firstUnranked = order.findIndex((form) => !ranked.has(leadIdOf(form) ?? ""));
    expect(firstUnranked).toBeGreaterThan(lastRanked);
  });

  it("keeps every form exactly once, so a newly wired form cannot be dropped", () => {
    const forms = allForms();
    const order = sortFormsForSweep(forms);
    expect(order.length).toBe(forms.length);
    expect(new Set(order)).toEqual(new Set(forms));
  });

  it("is stable within a rank, so S-1 precedes S-1/A precedes DRS", () => {
    const order = sortFormsForSweep(allForms());
    expect(order.indexOf("S-1")).toBeLessThan(order.indexOf("S-1/A"));
    expect(order.indexOf("S-1/A")).toBeLessThan(order.indexOf("DRS"));
  });

  it("orders an explicit form subset too", () => {
    expect(sortFormsForSweep(["25", "8-K", "S-1"])).toEqual(["S-1", "8-K", "25"]);
  });

  it("leaves a form with no registered extractor at the end rather than dropping it", () => {
    // The caller decides what happens to an unreadable form — a named one is
    // refused, one merely encountered is skipped with a warning — and the sort
    // must not silently swallow it before either of those can happen.
    expect(sortFormsForSweep(["NOT-A-FORM", "25", "S-1"])).toEqual(["S-1", "25", "NOT-A-FORM"]);
  });
});
